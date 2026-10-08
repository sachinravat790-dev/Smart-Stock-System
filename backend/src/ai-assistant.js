import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { loadAssistantFacts } from "./assistant-data.js";
import { validateAssistantQuestion } from "./assistant-validation.js";
import {
  AssistantConfigurationError,
  AssistantProviderError,
  AssistantTimeoutError,
  requestAssistantAnswer,
} from "./assistant-service.js";

export const aiAssistantRouter = Router();

aiAssistantRouter.use(requireUser, requireOwner);

aiAssistantRouter.post("/", async (request, response, next) => {
  const validation = validateAssistantQuestion(request.body);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  try {
    const facts = await loadAssistantFacts();
    const answer = await requestAssistantAnswer(validation.question, facts);
    response.json({ success: true, answer, as_of_date: facts.as_of_date });
  } catch (error) {
    if (error instanceof AssistantConfigurationError) {
      response.status(503).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof AssistantTimeoutError) {
      response.status(504).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof AssistantProviderError) {
      response.status(502).json({ success: false, error: error.message });
      return;
    }
    next(error);
  }
});

function requireOwner(request, response, next) {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required to use the AI Assistant.",
    });
    return;
  }
  next();
}
