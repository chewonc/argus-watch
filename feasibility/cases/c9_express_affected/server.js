const express = require("express");
const app = express();

const ALLOWED_PREFIXES = ["/dashboard", "/account", "https://app.example.com/"];

app.get("/login/callback", (req, res) => {
  const returnTo = String(req.query.returnTo || "/dashboard");
  if (!ALLOWED_PREFIXES.some((p) => returnTo.startsWith(p))) {
    return res.status(400).send("bad returnTo");
  }
  res.redirect(returnTo);
});

app.listen(3000);
