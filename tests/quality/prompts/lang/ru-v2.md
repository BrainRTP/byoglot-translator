Write the Russian text the way a Russian-speaking developer would write it from scratch for other developers. Do not translate word by word: first understand what the paragraph says, then say it in Russian as you would explain it to a colleague.

- Translate the meaning, not the sentence structure. Rebuild each sentence in natural Russian word order. You may split a long sentence into two or three, join short ones, and drop filler words that add nothing (actually, in fact, really, simply, effectively, note that). Never drop a fact, condition, negation, number, example or link.
- Prefer verbs to chains of nouns: "Spring загружает ресурс", not "осуществляется загрузка ресурса". Avoid chains of three or more nouns in the genitive case.
- Avoid bureaucratic words and calques: "является" (use a dash or rephrase), "посредством" (через, с помощью), "осуществлять", "данный" (этот), "рассмотрите возможность" (say what to do), "фактически" for "actually" or "effectively" when it adds nothing, "в целях", "производить".
- Drop "вы", "вам", "ваш" when the sentence works without them. Use impersonal or imperative forms: "Если нужно...", "Используйте...".
- Use the terms Russian-speaking developers actually use: бин (bean), резолвер (resolver), сеттер (setter), загрузчик классов (class loader), автосвязывание (autowiring), шаблон с подстановкой or wildcard (wildcard). Keep words that developers write in Latin letters as they are: classpath, JAR, URL, API, HTTP. Use one rendering of a term for the whole page.
- When one Russian word would stand for two different English terms (template and pattern are both "шаблон"), pick a different word for one of them so the reader can tell them apart.
- Titles of sections, articles and links are not names: always translate them, including references like "see Using @Value" ("см. раздел «Использование @Value»"). Keep in English only code, names of classes, methods and files, product names and people's names.
- A placeholder like <x1/> stands for a piece of code, usually a class, interface, method or type name. Treat it as a noun and build the Russian grammar around it: "интерфейс <x1/>", "Особенности <x1/>", not "<x1/> Интерфейс" or "<x1/> Предостережения".
- Headings are short Russian noun phrases with a capital letter only at the start.
- Never use the Cyrillic letter U+0451 (e with diaeresis); always write the plain "е" instead.

Examples of the difference (the style matters, not the words):
- "This flag is meant to be used only for debugging." Literal: "Этот флаг предназначен для того, чтобы использоваться только для отладки." Good: "Этот флаг нужен только для отладки."
- "Calling flush() writes the buffer to disk. However, the file is still open." Literal: "Вызов flush() записывает буфер на диск. Однако файл по-прежнему является открытым." Good: "flush() запишет буфер на диск, но файл останется открытым."
- "You may want to consider caching the results." Literal: "Возможно, вы захотите рассмотреть возможность кэширования результатов." Good: "Результаты стоит кэшировать."
- "The scheduler's ability to retry jobs depends on the queue backend." Literal: "Способность планировщика повторять задания зависит от бэкенда очереди." Good: "Сможет ли планировщик повторить задание, зависит от бэкенда очереди."
