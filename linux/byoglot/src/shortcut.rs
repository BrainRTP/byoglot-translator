use crate::{
    APP_ID,
    i18n::{Msg, tr},
};
use adw::prelude::*;
use ashpd::desktop::{
    Session,
    global_shortcuts::{GlobalShortcuts, NewShortcut},
};
use futures_util::StreamExt;
use gtk::glib;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

const SHORTCUT_ID: &str = "translate-selection";
pub const FALLBACK_COMMAND: &str = "byoglot --translate-selection";

#[derive(Debug)]
pub struct ShortcutError;

pub(crate) async fn register_host() -> Result<(), ShortcutError> {
    static REGISTERED: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
    REGISTERED
        .get_or_try_init(|| async {
            ashpd::register_host_app(APP_ID.parse().map_err(|_| ShortcutError)?)
                .await
                .map_err(|_| ShortcutError)
        })
        .await
        .map(|_| ())
}

pub struct ShortcutStatus {
    portal: GlobalShortcuts,
    session: Arc<Session<GlobalShortcuts>>,
    trigger: gtk::Label,
    listeners: Vec<glib::JoinHandle<()>>,
}
impl Drop for ShortcutStatus {
    fn drop(&mut self) {
        for listener in &self.listeners {
            listener.abort();
        }
        let session = self.session.clone();
        glib::spawn_future_local(async move {
            let _ = session.close().await;
        });
    }
}

pub async fn bind(app: &adw::Application) -> Result<ShortcutStatus, ShortcutError> {
    register_host().await?;
    let portal = GlobalShortcuts::new().await.map_err(|_| ShortcutError)?;
    let session = Arc::new(
        portal
            .create_session(Default::default())
            .await
            .map_err(|_| ShortcutError)?,
    );
    let path = serde_json::to_value(session.as_ref())
        .map_err(|_| ShortcutError)?
        .as_str()
        .ok_or(ShortcutError)?
        .to_owned();
    let activated = portal
        .receive_activated()
        .await
        .map_err(|_| ShortcutError)?;
    let changed = portal
        .receive_shortcuts_changed()
        .await
        .map_err(|_| ShortcutError)?;
    let shortcut = NewShortcut::new(SHORTCUT_ID, tr(Msg::ShortcutDescription))
        .preferred_trigger("<Control><Alt>t");
    let response = portal
        .bind_shortcuts(&session, &[shortcut], None, Default::default())
        .await
        .map_err(|_| ShortcutError)?
        .response()
        .map_err(|_| ShortcutError)?;
    let Some(shortcut) = response.shortcuts().iter().find(|s| s.id() == SHORTCUT_ID) else {
        let _ = session.close().await;
        return Err(ShortcutError);
    };
    let trigger = gtk::Label::new(Some(shortcut.trigger_description()));
    let weak = app.downgrade();
    let activation_path = path.clone();
    let activation = glib::spawn_future_local(async move {
        let mut activated = std::pin::pin!(activated);
        while let Some(event) = activated.next().await {
            if event.session_handle().as_str() == activation_path
                && event.shortcut_id() == SHORTCUT_ID
                && let Some(app) = weak.upgrade()
            {
                if let Some(token) = event
                    .options()
                    .get("activation_token")
                    .and_then(|v| <&str>::try_from(v).ok())
                {
                    app.activate_action("portal-token", Some(&token.to_variant()));
                }
                app.activate_action(SHORTCUT_ID, None);
            }
        }
    });
    let status = trigger.downgrade();
    let changes = glib::spawn_future_local(async move {
        let mut changed = std::pin::pin!(changed);
        while let Some(event) = changed.next().await {
            if event.session_handle().as_str() == path
                && let Some(status) = status.upgrade()
            {
                status.set_label(
                    event
                        .shortcuts()
                        .iter()
                        .find(|s| s.id() == SHORTCUT_ID)
                        .map(|s| s.trigger_description())
                        .unwrap_or(tr(Msg::ShortcutFallback)),
                );
            }
        }
    });
    let status = trigger.downgrade();
    let closed_session = session.clone();
    let closure = glib::spawn_future_local(async move {
        let Ok(closed) = closed_session.receive_closed().await else {
            return;
        };
        let mut closed = std::pin::pin!(closed);
        if closed.next().await.is_some()
            && let Some(status) = status.upgrade()
        {
            status.set_label(tr(Msg::ShortcutFallback));
        }
    });
    Ok(ShortcutStatus {
        portal,
        session,
        trigger,
        listeners: vec![activation, changes, closure],
    })
}

pub struct Registration {
    current: RefCell<Option<ShortcutStatus>>,
    busy: Cell<bool>,
    pub description: gtk::Label,
}
impl Default for Registration {
    fn default() -> Self {
        Self {
            current: RefCell::new(None),
            busy: Cell::new(false),
            description: gtk::Label::new(Some(tr(Msg::ShortcutFallback))),
        }
    }
}
impl Registration {
    pub fn start(self: &Rc<Self>, app: &adw::Application) {
        if self.busy.replace(true) {
            return;
        }
        self.description.set_label(tr(Msg::ShortcutBinding));
        let weak = Rc::downgrade(self);
        let app = app.clone();
        glib::spawn_future_local(async move {
            let result = bind(&app).await;
            if let Some(registration) = weak.upgrade() {
                if let Ok(status) = result {
                    registration.description.set_label(&status.trigger.label());
                    let description = registration.description.downgrade();
                    status.trigger.connect_label_notify(move |status| {
                        if let Some(description) = description.upgrade() {
                            description.set_label(&status.label());
                        }
                    });
                    *registration.current.borrow_mut() = Some(status);
                } else {
                    registration
                        .description
                        .set_label(tr(Msg::ShortcutFallback));
                }
                registration.busy.set(false);
            }
        });
    }
    pub fn shutdown(&self) {
        self.current.borrow_mut().take();
    }
    pub fn group(self: &Rc<Self>, window: &adw::ApplicationWindow) -> adw::PreferencesGroup {
        let group = adw::PreferencesGroup::builder()
            .title(tr(Msg::KeyboardShortcuts))
            .build();
        let label = gtk::Label::builder()
            .label(self.description.label())
            .wrap(true)
            .xalign(0.0)
            .selectable(true)
            .build();
        let weak_label = label.downgrade();
        self.description.connect_label_notify(move |description| {
            if let Some(label) = weak_label.upgrade() {
                label.set_text(&description.label());
            }
        });
        group.add(&label);
        let buttons = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        let change = gtk::Button::with_label(tr(Msg::ShortcutChange));
        let copy = gtk::Button::with_label(tr(Msg::Copy));
        copy.connect_clicked(|button| button.clipboard().set_text(FALLBACK_COMMAND));
        buttons.append(&change);
        buttons.append(&copy);
        group.add(&buttons);
        let weak = Rc::downgrade(self);
        let parent = window.downgrade();
        change.connect_clicked(move |button| {
            let (Some(registration), Some(window)) = (weak.upgrade(), parent.upgrade()) else {
                return;
            };
            if registration.busy.replace(true) {
                return;
            }
            let status = registration.current.borrow_mut().take();
            let button = button.clone();
            button.set_sensitive(false);
            glib::spawn_future_local(async move {
                let identifier = ashpd::WindowIdentifier::from_native(&window).await;
                if let Some(status) = status
                    && status.portal.version() >= 2
                {
                    if status
                        .portal
                        .configure_shortcuts(
                            &status.session,
                            identifier.as_ref(),
                            Default::default(),
                        )
                        .await
                        .is_err()
                    {
                        registration
                            .description
                            .set_label(tr(Msg::ShortcutFallback));
                    }
                    *registration.current.borrow_mut() = Some(status);
                    registration.busy.set(false);
                } else {
                    registration.busy.set(false);
                    if let Some(app) = window.application().and_downcast::<adw::Application>() {
                        registration.start(&app);
                    }
                }
                button.set_sensitive(true);
            });
        });
        group
    }
}
