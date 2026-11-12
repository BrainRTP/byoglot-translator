use crate::{BackendError, ModelRef, TextGenerator, TextPromptInput, build_text_prompt, contracts};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    future::{Future, poll_fn},
    pin::Pin,
    sync::Mutex,
    task::{Context, Poll, Waker},
};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRequest {
    pub text: String,
    pub context: String,
    pub app_name: String,
    pub source_lang: String,
    pub target_lang: String,
    pub pre_prompt: String,
    pub language_prompt: String,
    pub model: ModelRef,
}

struct QueueState {
    active: usize,
    next_id: u64,
    waiting: VecDeque<(u64, Waker)>,
}
struct Queue {
    state: Mutex<QueueState>,
    limit: usize,
}
impl Queue {
    fn acquire(&self) -> Acquire<'_> {
        Acquire {
            queue: self,
            id: None,
            acquired: false,
        }
    }
}
struct Acquire<'a> {
    queue: &'a Queue,
    id: Option<u64>,
    acquired: bool,
}
impl Future for Acquire<'_> {
    type Output = ();
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        let this = self.get_mut();
        let mut state = this.queue.state.lock().unwrap();
        if state.active < this.queue.limit
            && (state.waiting.is_empty() || state.waiting.front().map(|v| v.0) == this.id)
        {
            if this.id.is_some() {
                state.waiting.pop_front();
            }
            state.active += 1;
            this.acquired = true;
            let wake = if state.active < this.queue.limit {
                state.waiting.front().map(|v| v.1.clone())
            } else {
                None
            };
            drop(state);
            if let Some(waker) = wake {
                waker.wake();
            }
            return Poll::Ready(());
        }
        if let Some(id) = this.id {
            if let Some((_, waker)) = state.waiting.iter_mut().find(|v| v.0 == id) {
                waker.clone_from(cx.waker());
            }
        } else {
            let id = state.next_id;
            state.next_id += 1;
            this.id = Some(id);
            state.waiting.push_back((id, cx.waker().clone()));
        }
        Poll::Pending
    }
}
impl Drop for Acquire<'_> {
    fn drop(&mut self) {
        let mut state = self.queue.state.lock().unwrap();
        if self.acquired {
            state.active -= 1;
        } else if let Some(id) = self.id {
            state.waiting.retain(|v| v.0 != id);
        }
        let wake = state.waiting.front().map(|v| v.1.clone());
        drop(state);
        if let Some(waker) = wake {
            waker.wake();
        }
    }
}
struct Cache {
    entries: VecDeque<(TextRequest, u64, String)>,
    generation: u64,
}
pub struct Translator<F> {
    make_generator: F,
    cache_limit: usize,
    cache: Mutex<Cache>,
    queue: Queue,
}
impl<F> Translator<F> {
    pub fn new(make_generator: F, cache_limit: usize) -> Self {
        Self {
            make_generator,
            cache_limit,
            cache: Mutex::new(Cache {
                entries: VecDeque::new(),
                generation: 0,
            }),
            queue: Queue {
                state: Mutex::new(QueueState {
                    active: 0,
                    next_id: 0,
                    waiting: VecDeque::new(),
                }),
                limit: contracts::limits().concurrency,
            },
        }
    }
    pub fn clear_cache(&self) {
        let mut cache = self.cache.lock().unwrap();
        cache.entries.clear();
        cache.generation += 1;
    }
    pub(crate) async fn translate_with<G: TextGenerator>(
        &self,
        request: TextRequest,
        generator: &G,
        namespace: u64,
    ) -> Result<String, BackendError> {
        let mut permit = self.queue.acquire();
        poll_fn(|cx| Pin::new(&mut permit).poll(cx)).await;
        let generation = {
            let mut cache = self.cache.lock().unwrap();
            if let Some(index) = cache
                .entries
                .iter()
                .position(|(r, n, _)| *r == request && *n == namespace)
            {
                let entry = cache.entries.remove(index).unwrap();
                let result = entry.2.clone();
                cache.entries.push_back(entry);
                return Ok(result);
            }
            cache.generation
        };
        let prompt = build_text_prompt(&TextPromptInput {
            pre_prompt: request.pre_prompt.clone(),
            language_prompt: request.language_prompt.clone(),
            source_lang: request.source_lang.clone(),
            target_lang: request.target_lang.clone(),
            text: request.text.clone(),
            context: request.context.clone(),
            app_name: request.app_name.clone(),
        });
        let result = generator
            .generate(&prompt, &request.model)
            .await?
            .trim()
            .to_owned();
        if self.cache_limit > 0 {
            let mut cache = self.cache.lock().unwrap();
            if cache.generation == generation {
                cache
                    .entries
                    .retain(|(r, n, _)| *r != request || *n != namespace);
                cache
                    .entries
                    .push_back((request, namespace, result.clone()));
                while cache.entries.len() > self.cache_limit {
                    cache.entries.pop_front();
                }
            }
        }
        Ok(result)
    }
}
impl<F> Translator<F> {
    pub async fn translate<G: TextGenerator>(
        &self,
        request: TextRequest,
    ) -> Result<String, BackendError>
    where
        F: Fn(&ModelRef) -> G,
    {
        let generator = (self.make_generator)(&request.model);
        self.translate_with(request, &generator, 0).await
    }
}
