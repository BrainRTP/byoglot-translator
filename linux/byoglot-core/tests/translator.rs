mod common;
use byoglot_core::*;
use common::*;
use std::{
    future::{Future, poll_fn},
    pin::pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    task::Poll,
    time::Duration,
};

#[derive(Clone)]
struct Generator {
    calls: Arc<AtomicUsize>,
    prompts: Arc<Mutex<Vec<String>>>,
    active: Arc<AtomicUsize>,
    peak: Arc<AtomicUsize>,
    fail_first: bool,
}
struct Active(Arc<AtomicUsize>);
impl Drop for Active {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
impl Generator {
    fn new() -> Self {
        Self {
            calls: Arc::default(),
            prompts: Arc::default(),
            active: Arc::default(),
            peak: Arc::default(),
            fail_first: false,
        }
    }
}
impl TextGenerator for Generator {
    async fn generate(&self, prompt: &str, _: &ModelRef) -> Result<String, BackendError> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        self.prompts.lock().unwrap().push(prompt.into());
        let count = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        let _active = Active(self.active.clone());
        self.peak.fetch_max(count, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(10)).await;
        if self.fail_first && call == 0 {
            Err(BackendError::new(ErrorKind::Offline))
        } else {
            Ok(" answer \n".into())
        }
    }
}
#[tokio::test]
async fn trims_answer_uses_contract_prompt_and_caches_identical_requests() {
    let generator = Generator::new();
    let translator = Translator::new(|_: &ModelRef| generator.clone(), 2);
    let case = fixture::<TextPromptInput, String>("prompt-text").remove(0);
    let i = case.input;
    let r = TextRequest {
        pre_prompt: i.pre_prompt,
        language_prompt: i.language_prompt,
        source_lang: i.source_lang,
        target_lang: i.target_lang,
        text: i.text,
        context: i.context,
        app_name: i.app_name,
        model: model(),
    };
    assert_eq!(translator.translate(r.clone()).await.unwrap(), "answer");
    assert_eq!(translator.translate(r.clone()).await.unwrap(), "answer");
    assert_eq!(generator.calls.load(Ordering::SeqCst), 1);
    assert_eq!(generator.prompts.lock().unwrap()[0], case.expected);
    translator.clear_cache();
    translator.translate(r).await.unwrap();
    assert_eq!(generator.calls.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn failures_are_not_cached() {
    let mut generator = Generator::new();
    generator.fail_first = true;
    let translator = Translator::new(|_: &ModelRef| generator.clone(), 2);
    assert!(translator.translate(request()).await.is_err());
    assert!(translator.translate(request()).await.is_ok());
    assert_eq!(generator.calls.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn ten_concurrent_requests_peak_at_four_and_wait_in_order() {
    let generator = Generator::new();
    let translator = Arc::new(Translator::new(
        {
            let g = generator.clone();
            move |_: &ModelRef| g.clone()
        },
        0,
    ));
    let mut tasks = tokio::task::JoinSet::new();
    for index in 0..10 {
        let translator = translator.clone();
        tasks.spawn(async move {
            let mut r = request();
            r.text = index.to_string();
            translator.translate(r).await.unwrap()
        });
        tokio::task::yield_now().await;
    }
    while let Some(result) = tasks.join_next().await {
        result.unwrap();
    }
    assert_eq!(generator.peak.load(Ordering::SeqCst), 4);
    let prompts = generator.prompts.lock().unwrap();
    assert_eq!(
        prompts
            .iter()
            .map(|p| p.rsplit('\n').next().unwrap())
            .collect::<Vec<_>>(),
        (0..10).map(|i| i.to_string()).collect::<Vec<_>>()
    );
}
#[tokio::test]
async fn dropping_the_future_cancels_and_releases_the_queue_slot() {
    let generator = Generator::new();
    let translator = Translator::new(|_: &ModelRef| generator.clone(), 0);
    {
        let mut future = pin!(translator.translate(request()));
        poll_fn(|cx| {
            assert!(future.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        assert_eq!(generator.active.load(Ordering::SeqCst), 1);
    }
    assert_eq!(generator.active.load(Ordering::SeqCst), 0);
    assert!(translator.translate(request()).await.is_ok());
}
#[tokio::test]
async fn cache_evicts_the_least_recently_used_entry() {
    let generator = Generator::new();
    let translator = Translator::new(|_: &ModelRef| generator.clone(), 2);
    for text in ["a", "b", "a", "c", "a", "b"] {
        let mut r = request();
        r.text = text.into();
        translator.translate(r).await.unwrap();
    }
    assert_eq!(generator.calls.load(Ordering::SeqCst), 4);
}
