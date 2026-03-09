import { z } from "zod";

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

export const api = {
  uploads: {
    list: {
      method: "GET" as const,
      path: "/api/uploads" as const,
      responses: {
        200: z.array(z.any()),
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/uploads/:id" as const,
      responses: {
        200: z.any(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/uploads" as const,
      // multipart/form-data — no input schema needed
      responses: {
        201: z.any(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: "DELETE" as const,
      path: "/api/uploads/:id" as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  clips: {
    list: {
      method: "GET" as const,
      path: "/api/uploads/:uploadId/clips" as const,
      responses: {
        200: z.array(z.any()),
        404: errorSchemas.notFound,
      },
    },
    generate: {
      method: "POST" as const,
      path: "/api/uploads/:uploadId/generate" as const,
      input: z.object({
        durations: z.array(z.union([z.literal(15), z.literal(20), z.literal(30), z.literal(45)])),
      }),
      responses: {
        200: z.any(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    download: {
      method: "GET" as const,
      path: "/api/clips/:clipId/download" as const,
      responses: {
        200: z.any(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: "DELETE" as const,
      path: "/api/clips/:clipId" as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type GenerateClipsInput = z.infer<typeof api.clips.generate.input>;
