import { z } from 'zod';

export const BlogSchema = z.object({
  id: z.number(),
  title: z.string(),
  contentPreview: z.string(),
  author: z.string(),
  likes: z.number(),
  comments: z.number(),
  likedByMe: z.boolean(),
  createdByMe: z.boolean(),
  headerImageUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Blog = z.infer<typeof BlogSchema>;

export const BlogResponseSchema = z.object({
  data: z.array(BlogSchema),
  totalCount: z.number(),
  pageIndex: z.number(),
  pageSize: z.number(),
  maxPageSize: z.number(),
});

export type BlogResponse = z.infer<typeof BlogResponseSchema>;

export const BlogCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BlogComment = z.infer<typeof BlogCommentSchema>;

export const BlogDetailSchema = BlogSchema.omit({
  contentPreview: true,
  comments: true,
}).extend({
  content: z.string(),
  comments: z.array(BlogCommentSchema),
});

export type BlogDetail = z.infer<typeof BlogDetailSchema>;

export const CreateBlogSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  headerImageUrl: z.string().url().optional(),
});

export type CreateBlog = z.infer<typeof CreateBlogSchema>;
