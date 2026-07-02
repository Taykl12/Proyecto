import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AdminRoute } from "./components/auth/AdminRoute";
import { ProfessorRoute } from "./components/auth/ProfessorRoute";
import { HomeRedirect } from "./components/auth/HomeRedirect";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import CalendaryPage from "./pages/Calendary";
import AdminCursosPage from "./pages/admin/AdminCursosPage";
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import AdminMateriasPage from "./pages/admin/AdminMateriasPage";
import AdminProyectosPage from "./pages/admin/AdminProyectosPage";
import AdminEsp32Page from "./pages/admin/AdminEsp32Page";
import AdminUsersPage from "./pages/admin/AdminUsersPage";
import ProfessorAttendanceCoursePage from "./pages/professor/ProfessorAttendanceCoursePage";
import ProfessorAttendancePage from "./pages/professor/ProfessorAttendancePage";
import ProfessorCourseDetailPage from "./pages/professor/ProfessorCourseDetailPage";
import ProfessorCoursesPage from "./pages/professor/ProfessorCoursesPage";
import ProfessorDashboardPage from "./pages/professor/ProfessorDashboardPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import ProjectConfigPage from "./pages/ProjectConfigPage";
import ProjectsPage from "./pages/ProjectsPage";
import PreferencesPage from "./pages/PreferencesPage";
import RecoverPasswordPage from "./pages/RecoverPasswordPage";
import RegisterPage from "./pages/RegisterPage";
import { ROUTES } from "./routes";

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
        <Routes>
          <Route path={ROUTES.HOME} element={<HomeRedirect />} />
          <Route
            path={ROUTES.ADMIN}
            element={
              <AdminRoute>
                <AdminDashboardPage />
              </AdminRoute>
            }
          />
          <Route
            path={ROUTES.ADMIN_USERS}
            element={
              <AdminRoute>
                <AdminUsersPage />
              </AdminRoute>
            }
          />
          <Route
            path={ROUTES.ADMIN_COURSES}
            element={
              <AdminRoute>
                <AdminCursosPage />
              </AdminRoute>
            }
          />
          <Route
            path={ROUTES.ADMIN_SUBJECTS}
            element={
              <AdminRoute>
                <AdminMateriasPage />
              </AdminRoute>
            }
          />
          <Route
            path={ROUTES.ADMIN_PROJECTS}
            element={
              <AdminRoute>
                <AdminProyectosPage />
              </AdminRoute>
            }
          />
          <Route
            path={ROUTES.ADMIN_ESP32}
            element={
              <AdminRoute>
                <AdminEsp32Page />
              </AdminRoute>
            }
          />
          <Route
            path={ROUTES.PROFESSOR}
            element={
              <ProfessorRoute>
                <ProfessorDashboardPage />
              </ProfessorRoute>
            }
          />
          <Route
            path={ROUTES.PROFESSOR_COURSES}
            element={
              <ProfessorRoute>
                <ProfessorCoursesPage />
              </ProfessorRoute>
            }
          />
          <Route
            path="/profesor/cursos/:courseId"
            element={
              <ProfessorRoute>
                <ProfessorCourseDetailPage />
              </ProfessorRoute>
            }
          />
          <Route
            path={ROUTES.PROFESSOR_ATTENDANCE}
            element={
              <ProfessorRoute>
                <ProfessorAttendancePage />
              </ProfessorRoute>
            }
          />
          <Route
            path="/profesor/asistencia/:courseId"
            element={
              <ProfessorRoute>
                <ProfessorAttendanceCoursePage />
              </ProfessorRoute>
            }
          />
          <Route
            path={ROUTES.DASHBOARD}
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path={ROUTES.PROJECTS}
            element={
              <ProtectedRoute>
                <ProjectsPage />
              </ProtectedRoute>
            }
          />
          <Route
           path={ROUTES.CALENDARY}
            element={
              <ProtectedRoute>
                <CalendaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path={ROUTES.PREFERENCES}
            element={
              <ProtectedRoute>
                <PreferencesPage />
              </ProtectedRoute>
            }
          />
          <Route 
            path="/proyectos/:projectId/config"
            element={
              <ProtectedRoute>
                <ProjectConfigPage />
              </ProtectedRoute>
            }
          />
          <Route path={ROUTES.LOGIN} element={<LoginPage />} />
          <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
          <Route path={ROUTES.RECOVER_PASSWORD} element={<RecoverPasswordPage />} />
          <Route path="*" element={<Navigate to={ROUTES.LOGIN} replace />} />
        </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
