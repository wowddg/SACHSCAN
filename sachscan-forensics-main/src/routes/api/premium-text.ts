import { createFileRoute } from "@tanstack/react-router";
import { x402HTTPResourceServer } from "@x402/core/http";

import {
  x402Server,
  premiumAnalysisPayment,
} from "@/lib/x402.server";

import { detectAiText } from "@/lib/text-detection.server";

const httpServer = new x402HTTPResourceServer(x402Server, {
  "POST /api/premium-text": {
    accepts: premiumAnalysisPayment,
    description: "SACHSCAN Full Verification",
    mimeType: "application/json",
  },
});

let initialized: Promise<void> | undefined;

function ensureInitialized() {
  if (!initialized) {
    initialized = httpServer.initialize();
  }

  return initialized;
}

function createResponse(response: {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  return new Response(
    response.body === undefined
      ? undefined
      : JSON.stringify(response.body),
    {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        ...(response.headers ?? {}),
      },
    },
  );
}

export const Route = createFileRoute("/api/premium-text")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await ensureInitialized();

        const adapter = {
          getMethod: () => request.method,
          getUrl: () => request.url,
          getPath: () => new URL(request.url).pathname,
          getHeader: (name: string) =>
            request.headers.get(name) ?? undefined,
          getAcceptHeader: () =>
            request.headers.get("accept") ?? "",
          getUserAgent: () =>
            request.headers.get("user-agent") ?? "",
        };

        const context = {
          adapter,
          path: new URL(request.url).pathname,
          method: request.method,
        };

        const paymentResult =
          await httpServer.processHTTPRequest(context);

        if (paymentResult.type === "payment-error") {
          return createResponse(paymentResult.response);
        }

        if (paymentResult.type === "no-payment-required") {
          return new Response(
            JSON.stringify({
              error: "Payment route configuration error",
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
              },
            },
          );
        }

        const body = await request.json();

        if (
          typeof body !== "object" ||
          body === null ||
          typeof (body as { text?: unknown }).text !== "string"
        ) {
          return new Response(
            JSON.stringify({
              error: "Text is required",
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
              },
            },
          );
        }

        const text = (body as { text: string }).text.trim();

        if (text.split(/\s+/).filter(Boolean).length < 25) {
          return new Response(
            JSON.stringify({
              error:
                "Please provide at least 25 words.",
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
              },
            },
          );
        }

        const analysis = await detectAiText(text);

        const transportContext = {
          request: context,
        };

        const settlement =
          await httpServer.processSettlement(
            paymentResult.paymentPayload,
            paymentResult.paymentRequirements,
            paymentResult.declaredExtensions,
            transportContext,
          );

        if (!settlement.success) {
          return createResponse(settlement.response);
        }

        return new Response(
          JSON.stringify({
            success: true,
            analysis,
            verification: {
              status: "paid",
              network:
                paymentResult.paymentRequirements.network,
              transaction: settlement.transaction,
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...settlement.headers,
            },
          },
        );
      },
    },
  },
});