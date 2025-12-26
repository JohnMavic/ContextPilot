"""Azure Function HTTP Trigger für CONTEXTPILOT MFA."""

from __future__ import annotations

import json
import os
import uuid

import azure.functions as func

from mfa_workflow import run_mfa_workflow

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


@app.route(route="mfa", methods=["POST"])
async def mfa_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """HTTP Endpoint für MFA-Anfragen.

    Request Body:
        { "prompt": "..." }

    Response:
        { "output_text": "...", "workflow": "mfa" }
    """

    correlation_id = req.headers.get("x-correlation-id") or str(uuid.uuid4())

    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=400,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )

    prompt = (body or {}).get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return func.HttpResponse(
            json.dumps({"error": "Missing 'prompt' in request body"}),
            status_code=400,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )

    try:
        result = await run_mfa_workflow(prompt)
        return func.HttpResponse(
            json.dumps({
                "output_text": result["response"],
                "workflow": "mfa",
                "agents_used": result["agents_used"],
                "routing": {
                    "direct": result["routing"].get("direct", False),
                    "web": result["routing"].get("web", False),
                    "context": result["routing"].get("context", False),
                    "reasoning": result["routing"].get("reasoning", ""),
                },
            }),
            status_code=200,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )
    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e), "hint": "Check Azure Function logs for details"}),
            status_code=500,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )
