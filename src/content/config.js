import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title:       z.string(),
    pubDate:     z.coerce.date(),
    description: z.string().optional(),
    tags:        z.array(z.string()).default([]),
    category:    z.string().default('労務管理'),
    sourceUrl:   z.string().url().optional(),
    aiGenerated: z.boolean().default(true),
    draft:       z.boolean().default(false),
  }),
});

export const collections = { blog: blogCollection };
