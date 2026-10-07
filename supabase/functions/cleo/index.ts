import { handle, type Env } from './handler.ts';

Deno.serve((req) => handle(req, Deno.env.toObject() as Env));
