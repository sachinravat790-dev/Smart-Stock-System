import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import InventoryPage from "./Inventory.jsx";
import ExpiryAlertsPage from "./ExpiryAlerts.jsx";
import ProductLocatorPage from "./ProductLocator.jsx";
import ReceiveStockPage from "./ReceiveStock.jsx";
import QuickSalePage from "./QuickSale.jsx";
import StockAuditPage from "./StockAudit.jsx";
import PaymentReconciliationPage from "./PaymentReconciliation.jsx";
import StaffActivityPage from "./StaffActivity.jsx";
import DashboardPage from "./Dashboard.jsx";
import ReportsPage from "./Reports.jsx";
import AIAssistantPage from "./AIAssistant.jsx";
import { apiFetch } from "./api.js";

const AuthContext = createContext(null);

const ownerSections = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inventory", label: "Inventory" },
  { id: "receive-stock", label: "Receive Stock" },
  { id: "sales", label: "Sales" },
  { id: "find-product", label: "Find Product" },
  { id: "expiry", label: "Expiry" },
  { id: "audit", label: "Audit" },
  { id: "payments", label: "Payments" },
  { id: "staff-activity", label: "Staff Activity" },
  { id: "reports", label: "Reports" },
  { id: "ai-assistant", label: "AI Assistant" },
];

const staffSections = [
  { id: "quick-sale", label: "Quick Sale" },
  { id: "receive-stock", label: "Receive Stock" },
  { id: "find-product", label: "Find Product" },
];

function homeForRole(role) {
  return role === "owner" ? "/owner/dashboard" : "/staff/quick-sale";
}

async function readResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initializationError, setInitializationError] = useState("");

  useEffect(() => {
    let active = true;

    apiFetch("/api/auth/me")
      .then(async (response) => {
        const result = await readResponse(response);
        if (!active) return;
        if (response.ok) setUser(result.user);
        else if (response.status !== 401) {
          setInitializationError("Could not verify your session. Try again.");
        }
      })
      .catch(() => {
        if (active) setInitializationError("Could not connect to SmartStock.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      loading,
      initializationError,
      async login(email, password) {
        const response = await apiFetch("/api/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const result = await readResponse(response);
        if (!response.ok) {
          throw new Error(result.error || "Unable to sign in.");
        }
        setUser(result.user);
      },
      async logout() {
        const response = await apiFetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
        });
        const result = await readResponse(response);
        if (!response.ok) {
          throw new Error(result.error || "Unable to log out.");
        }
        setUser(null);
      },
    }),
    [user, loading, initializationError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  return useContext(AuthContext);
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<RequireSession />}>
            <Route path="/owner" element={<ProtectedArea role="owner" />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path=":sectionId" element={<SectionPage />} />
            </Route>
            <Route path="/staff" element={<ProtectedArea role="staff" />}>
              <Route index element={<Navigate to="quick-sale" replace />} />
              <Route path=":sectionId" element={<SectionPage />} />
            </Route>
          </Route>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState />;
  return <Navigate to={user ? homeForRole(user.role) : "/login"} replace />;
}

function RequireSession() {
  const { user, loading, initializationError } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState />;
  if (initializationError) {
    return <main className="center-page"><p className="form-error">{initializationError}</p></main>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState />;
  return user ? <Navigate to={homeForRole(user.role)} replace /> : <LoginPage />;
}

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(location.state?.from || "/", { replace: true });
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="center-page">
      <section className="login-card">
        <BrandMark />
        <p className="eyebrow">SmartStock workspace</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to continue to your shop.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function ProtectedArea({ role }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState("");
  const sections = role === "owner" ? ownerSections : staffSections;

  if (user.role !== role) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  async function handleLogout() {
    setLogoutError("");
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(error.message);
    }
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark /><strong>SmartStock</strong></div>
        <p className="nav-caption">{role === "owner" ? "OWNER" : "STAFF"}</p>
        <nav aria-label={`${role} navigation`} className="main-nav">
          {sections.map((section) => (
            <NavLink
              key={section.id}
              to={`/${role}/${section.id}`}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <span className="nav-indicator" aria-hidden="true" />
              {section.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="user-avatar" aria-hidden="true">
              {user.name.trim().charAt(0).toUpperCase()}
            </div>
            <div className="user-details">
              <strong>{user.name}</strong>
              <span>{role === "owner" ? "Owner" : "Staff"}</span>
            </div>
          </div>
          <button className="logout-button" onClick={handleLogout}>Log out</button>
          {logoutError && <p className="form-error" role="alert">{logoutError}</p>}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">SmartStock · Phase 1</p>
            <span className="topbar-welcome">Hello, {user.name}</span>
          </div>
          <span className={`role-pill ${role}`}>{role}</span>
        </header>
        <Outlet />
      </main>
    </div>
  );
}

function SectionPage() {
  const { sectionId } = useParams();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const sections = user.role === "owner" ? ownerSections : staffSections;
  const currentSection = sections.find((section) => section.id === sectionId);
  const [status, setStatus] = useState({ state: "loading" });

  useEffect(() => {
    if (!currentSection) return undefined;
    const controller = new AbortController();

    apiFetch(`/api/auth/sections/${encodeURIComponent(sectionId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await readResponse(response);
        if (response.status === 401) {
          setUser(null);
          return;
        }
        if (!response.ok) {
          setStatus({ state: "error", message: result.error || "Access denied." });
          return;
        }
        setStatus({ state: "ready", message: result.message });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setStatus({ state: "error", message: "Could not load this area." });
        }
      });

    return () => controller.abort();
  }, [sectionId, currentSection, setUser]);

  if (!currentSection) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  if (status.state === "error" && status.message === "Authentication is required.") {
    return <Navigate to="/login" replace />;
  }

  return (
    <section className="section-content">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{user.role === "owner" ? "Owner area" : "Staff area"}</p>
          <h1>{currentSection.label}</h1>
        </div>
        <span className="phase-chip">
          {sectionId === "dashboard"
            ? "Phase 10 · Owner overview"
            : sectionId === "reports"
              ? "Phase 11 · Reports & analytics"
              : sectionId === "ai-assistant"
                ? "Phase 12 · AI Smart Assistant"
            : sectionId === "expiry"
            ? "Phase 6 · Stock & expiry alerts"
            : sectionId === "audit"
              ? "Phase 7 · Stock audit"
              : sectionId === "payments"
                ? "Phase 8 · Payment reconciliation"
              : sectionId === "find-product"
              ? "Phase 4 · Smart locator"
              : sectionId === "receive-stock"
                ? "Phase 3 · Stock receiving"
                : sectionId === "inventory"
                  ? "Phase 2 · Inventory"
                  : sectionId === "sales"
                    ? "Phase 5 · Quick Sale"
                    : "Phase 1 · Access ready"}
        </span>
      </div>
      {status.state === "loading" ? (
        <div className="content-card muted">Verifying your access…</div>
      ) : status.state === "error" ? (
        <div className="content-card form-error" role="alert">{status.message}</div>
      ) : user.role === "owner" && sectionId === "dashboard" ? (
        <DashboardPage />
      ) : user.role === "owner" && sectionId === "inventory" ? (
        <InventoryPage />
      ) : user.role === "owner" && sectionId === "expiry" ? (
        <ExpiryAlertsPage />
      ) : user.role === "owner" && sectionId === "audit" ? (
        <StockAuditPage />
      ) : user.role === "owner" && sectionId === "payments" ? (
        <PaymentReconciliationPage />
      ) : user.role === "owner" && sectionId === "staff-activity" ? (
        <StaffActivityPage />
      ) : user.role === "owner" && sectionId === "reports" ? (
        <ReportsPage />
      ) : user.role === "owner" && sectionId === "ai-assistant" ? (
        <AIAssistantPage />
      ) : sectionId === "find-product" ? (
        <ProductLocatorPage />
      ) : sectionId === "receive-stock" ? (
        <ReceiveStockPage />
      ) : sectionId === "quick-sale" ? (
        <QuickSalePage />
      ) : user.role === "owner" && sectionId === "sales" ? (
        <QuickSalePage isOwner />
      ) : (
        <div className="content-card">
          <div className="card-icon" aria-hidden="true">✓</div>
          <h2>{currentSection.label} access is protected</h2>
          <p>{status.message}</p>
          <p className="muted">
            This area is an access-control placeholder. Its business functionality
            is reserved for a later SmartStock phase.
          </p>
        </div>
      )}
    </section>
  );
}

function LoadingState() {
  return <main className="center-page"><p className="muted">Loading SmartStock…</p></main>;
}

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true">SS</div>;
}
