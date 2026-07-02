import cors from "cors";
import express from "express";
import { config } from "./config.js";
import authRouter from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import adminProjectsRouter from "./routes/adminProjects.js";
import projectsRouter from "./routes/projects.js";
import dashboardRouter from "./routes/dashboard.js";
import usersRouter from "./routes/users.js";
import profileRouter from "./routes/profile.js";
import calendarRouter from "./routes/calendar.js";
import tasksRouter from "./routes/tasks.js";
import professorRouter from "./routes/professor.js";
import esp32DeviceRouter from "./routes/esp32Device.js";

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin: config.appOrigin,
      credentials: true,
    })
  );

  app.use("/api/device/esp32", esp32DeviceRouter);

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "classify-api" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/admin/proyectos", adminProjectsRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/calendar", calendarRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/professor", professorRouter);

  return app;
}
