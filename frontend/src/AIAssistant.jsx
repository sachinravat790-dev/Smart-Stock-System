import { useRef, useState } from "react";
import { apiFetch } from "./api.js";

const suggestedQuestions = [
  "What needs my attention today?",
  "Which products should I restock?",
  "Which products are expiring soon?",
  "What are my top-selling products?",
  "Which products are slow-moving?",
  "Are there any stock mismatches?",
  "Are there any payment mismatches?",
  "How are my sales today?",
  "What is today's profit?",
  "Give me a quick business summary.",
];

export default function AIAssistantPage() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  async function askAssistant(value = question) {
    const submittedQuestion = value.trim();
    if (!submittedQuestion || loading) return;

    setQuestion("");
    setError("");
    setLoading(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "owner", content: submittedQuestion },
    ]);

    try {
      const response = await apiFetch("/api/ai-assistant", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: submittedQuestion }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "The SmartStock assistant could not answer.");
      }
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          asOfDate: result.as_of_date,
        },
      ]);
    } catch (requestError) {
      setError(requestError.message || "The SmartStock assistant could not answer.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="assistant-page">
      <section className="assistant-intro content-card">
        <div className="assistant-mark" aria-hidden="true">AI</div>
        <div>
          <h2>Your business, explained</h2>
          <p>
            Ask about current SmartStock data. Answers use live inventory,
            sales, expiry, audit, and payment records.
          </p>
        </div>
      </section>

      {messages.length === 0 ? (
        <section className="assistant-suggestions content-card" aria-label="Suggested questions">
          <h2>Try asking</h2>
          <div className="assistant-suggestion-list">
            {suggestedQuestions.map((suggestion) => (
              <button
                className="assistant-suggestion"
                disabled={loading}
                key={suggestion}
                onClick={() => askAssistant(suggestion)}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="assistant-conversation content-card" aria-label="Conversation" aria-live="polite">
          {messages.map((message) => (
            <article className={`assistant-message ${message.role}`} key={message.id}>
              <span>{message.role === "owner" ? "You" : "SmartStock Assistant"}</span>
              <p>{message.content}</p>
              {message.asOfDate && <small>Business data as of {message.asOfDate}</small>}
            </article>
          ))}
          {loading && <p className="assistant-loading" role="status">Checking current business data…</p>}
          <div className="assistant-followups" aria-label="Suggested questions">
            {suggestedQuestions.slice(0, 4).map((suggestion) => (
              <button
                className="assistant-suggestion"
                disabled={loading}
                key={suggestion}
                onClick={() => askAssistant(suggestion)}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </section>
      )}

      <form
        className="assistant-composer content-card"
        onSubmit={(event) => {
          event.preventDefault();
          askAssistant();
        }}
      >
        <label className="sr-only" htmlFor="assistant-question">Ask the SmartStock assistant</label>
        <textarea
          id="assistant-question"
          maxLength={500}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a question about your shop…"
          ref={inputRef}
          rows={2}
          value={question}
        />
        <div className="assistant-composer-footer">
          {error ? (
            <p className="assistant-error" role="alert">{error}</p>
          ) : (
            <small>Answers are based on current SmartStock records; unavailable historical costs are not estimated.</small>
          )}
          <button className="primary-button" disabled={loading || !question.trim()} type="submit">
            {loading ? "Thinking…" : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}
