import { Router } from "express";
import { internalApi } from "../client";

export const users = Router();

users.get("/users/:id", async (req, res) => {
  const upstream = await internalApi.get(req.params.id);
  res.json(upstream.data);
});
