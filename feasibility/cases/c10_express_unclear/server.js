const express = require("express");
const { resolveReturnUrl } = require("./lib/return-url");
const app = express();

app.get("/login/callback", (req, res) => {
  res.redirect(resolveReturnUrl(req));
});

app.listen(3000);
