import assert from "node:assert/strict";
import test from "node:test";
import { loadAssistantFacts } from "../src/assistant-data.js";
import { validateAssistantQuestion } from "../src/assistant-validation.js";
import {
  AssistantConfigurationError,
  AssistantProviderError,
  assistantSystemInstructions,
  requestAssistantAnswer,
} from "../src/assistant-service.js";

test("assistant question validation trims and bounds input", () => {
  assert.deepEqual(validateAssistantQuestion({ question: "  How are sales?  " }), {
    valid: true,
    question: "How are sales?",
  });
  assert.equal(validateAssistantQuestion({ question: " " }).valid, false);
  assert.equal(validateAssistantQuestion({ question: "a".repeat(501) }).valid, false);
  assert.equal(validateAssistantQuestion({ question: ["not a string"] }).valid, false);
  assert.equal(validateAssistantQuestion(null).valid, false);
});

test("assistant facts query is read-only and returns the database summary", async () => {
  const facts = { as_of_date: "2026-10-08", today_sales: { sales_count: 3 } };
  let executedQuery = "";
  const result = await loadAssistantFacts({
    async query(query) {
      executedQuery = query;
      return { rows: [{ facts }] };
    },
  });

  assert.deepEqual(result, facts);
  assert.match(executedQuery, /purchase_price_snapshot/);
  assert.match(executedQuery, /stock_status/);
  assert.match(executedQuery, /expiry_status/);
  assert.match(executedQuery, /payment_reconciliations/);
  assert.match(executedQuery, /DISTINCT ON \(audit\.product_id\)/);
  assert.doesNotMatch(executedQuery, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});

test("assistant sends only supplied facts and the read-only system instructions", async () => {
  const facts = { today_sales: { sales_count: 4, revenue: "75.00" } };
  let request;
  const answer = await requestAssistantAnswer(
    "How are sales today?",
    facts,
    {
      provider: "openai-compatible",
      model: "test-model",
      apiKey: "test-secret",
      baseUrl: "https://llm.example/v1/",
      fetchImpl: async (url, options) => {
        request = { url: String(url), options, body: JSON.parse(options.body) };
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: "There were 4 sales totaling ₹75.00." } }] };
          },
        };
      },
    },
  );

  assert.equal(answer, "There were 4 sales totaling ₹75.00.");
  assert.equal(request.url, "https://llm.example/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer test-secret");
  assert.equal(request.body.model, "test-model");
  assert.equal(request.body.max_tokens, 450);
  assert.equal(request.body.max_completion_tokens, undefined);
  assert.equal(request.body.temperature, 0.2);
  assert.equal(request.body.tools, undefined);
  assert.match(request.body.messages[0].content, /Never invent/);
  assert.match(request.body.messages[0].content, /never accuse staff of theft/i);
  assert.deepEqual(JSON.parse(request.body.messages[1].content), {
    question: "How are sales today?",
    database_facts: facts,
  });
});

test("OpenAI requests use the supported completion token limit parameter", async () => {
  let requestBody;
  await requestAssistantAnswer("What needs attention?", {}, {
    provider: "openai",
    apiKey: "test-secret",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "No current alerts." } }] };
        },
      };
    },
  });

  assert.equal(requestBody.max_completion_tokens, 450);
  assert.equal(requestBody.max_tokens, undefined);
  assert.equal(requestBody.temperature, undefined);
});

test("assistant passes every suggested business question with real empty-result facts", async () => {
  const questions = [
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
  const facts = {
    as_of_date: "2026-10-08",
    today_sales: {
      sales_count: 0,
      revenue: "0.00",
      profit: "0.00",
      profit_cost_basis: "sale_items.purchase_price_snapshot",
      unavailable_cost_items: 0,
    },
    attention_counts: {
      low_stock: 0,
      out_of_stock: 0,
      expired: 0,
      expiring_within_30_days: 0,
      stock_mismatches: 0,
      payment_mismatches: 0,
    },
    low_stock_products: [],
    out_of_stock_products: [],
    expiring_products: [],
    top_selling_products_last_30_days: [],
    slow_moving_products_last_30_days: [],
    stock_mismatches: { count: 0, latest_product_audits: [] },
    payment_mismatches: { count: 0, latest_reconciliations: [] },
  };
  const sentQuestions = [];

  for (const question of questions) {
    await requestAssistantAnswer(question, facts, {
      apiKey: "test-secret",
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body);
        const submitted = JSON.parse(payload.messages[1].content);
        sentQuestions.push(submitted.question);
        assert.deepEqual(submitted.database_facts, facts);
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: "No matching records are available." } }] };
          },
        };
      },
    });
  }

  assert.deepEqual(sentQuestions, questions);
});

test("assistant reports missing API configuration without calling the provider", async () => {
  let called = false;
  await assert.rejects(
    requestAssistantAnswer("What needs attention?", {}, {
      apiKey: "",
      fetchImpl: async () => {
        called = true;
      },
    }),
    AssistantConfigurationError,
  );
  assert.equal(called, false);
});

test("assistant rejects unsupported provider formats without sending a request", async () => {
  let called = false;
  await assert.rejects(
    requestAssistantAnswer("What needs attention?", {}, {
      provider: "unsupported-provider",
      apiKey: "test-secret",
      fetchImpl: async () => {
        called = true;
      },
    }),
    AssistantConfigurationError,
  );
  assert.equal(called, false);
});

test("assistant provider errors do not expose provider response bodies", async () => {
  await assert.rejects(
    requestAssistantAnswer("What needs attention?", {}, {
      apiKey: "test-secret",
      fetchImpl: async () => ({ ok: false, async text() { return "provider secret details"; } }),
    }),
    (error) => {
      assert.ok(error instanceof AssistantProviderError);
      assert.doesNotMatch(error.message, /secret details|test-secret/);
      return true;
    },
  );
});

test("assistant system instructions require unavailable historical costs to be disclosed", () => {
  assert.match(assistantSystemInstructions, /purchase_price_snapshot/);
  assert.match(assistantSystemInstructions, /unavailable/);
  assert.match(assistantSystemInstructions, /never modify database data/i);
});
