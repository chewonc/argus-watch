import axios from "axios";

// Internal users service; the API key is attached to every request.
export const internalApi = axios.create({
  baseURL: "http://users.internal:8080/api/v1/users/",
  headers: { "X-API-KEY": process.env.USERS_API_KEY ?? "" },
});
