# Who will review the code

Adviser sends the function you changed to a language model and shows its review. The ways to get a model, from free to paid:

## 1. Free: OpenRouter

Models ending with `:free` cost nothing: up to 50 requests a day, which is about an hour and a half of study. You only need to sign up and get a key.

Note: with free models the provider may use requests to train its models. This is usually fine for study projects, but not for work code.

## Through GitHub Copilot

If you have GitHub Copilot, no key is needed: Adviser uses Copilot models through VS Code. Students can get Copilot for free through GitHub Education. Requests count against your Copilot plan. This path does not work in Cursor and Windsurf.

## 2. Locally: Ollama

Free, and the code never leaves your computer. You need a graphics card: models like `qwen2.5-coder:7b` run on 8 GB of video memory, `qwen2.5-coder:14b` and `gpt-oss:20b` on 16 GB. This path is not for a weak computer.

## 3. Your own key

Any OpenAI-compatible provider: OpenAI, DeepSeek, Groq, LM Studio and others. Paid, but usually more accurate. Spending and limits in dollars: the `adviser.budget.*` settings.

The key is stored in VS Code's secure storage, not in the settings.
