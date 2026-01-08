import { useState, useEffect } from "react";

interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

/**
 * UserMenu - Shows logged-in user and logout button
 * Only works on Azure Static Web Apps (/.auth/me endpoint)
 * Returns null on localhost (no auth)
 */
export function UserMenu() {
  const [user, setUser] = useState<ClientPrincipal | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocal, setIsLocal] = useState(false);

  useEffect(() => {
    // Check if running locally
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      setIsLocal(true);
      setLoading(false);
      return;
    }

    // Fetch user info from Azure SWA
    async function fetchUser() {
      try {
        const response = await fetch("/.auth/me");
        if (response.ok) {
          const data = await response.json();
          setUser(data.clientPrincipal);
        }
      } catch (error) {
        console.log("[UserMenu] Not authenticated or auth not available");
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, []);

  // Don't render anything while loading
  if (loading) return null;

  // On localhost, show dev indicator
  if (isLocal) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 12px",
        background: "#4a4a4a",
        borderRadius: "4px",
        fontSize: "12px",
        color: "#aaa"
      }}>
        <span>🔓 Dev Mode</span>
      </div>
    );
  }

  // Not logged in (should not happen with enforced auth)
  if (!user) {
    return (
      <a 
        href="/.auth/login/aad"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "4px 12px",
          background: "#0078d4",
          borderRadius: "4px",
          fontSize: "12px",
          color: "#fff",
          textDecoration: "none"
        }}
      >
        Login
      </a>
    );
  }

  // Logged in - show user and logout
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "4px 12px",
      background: "#2d2d2d",
      borderRadius: "4px",
      fontSize: "12px"
    }}>
      <span style={{ color: "#4fc3f7" }}>
        {user.userDetails}
      </span>
      <a 
        href="/.auth/logout?post_logout_redirect_uri=/"
        style={{
          padding: "2px 8px",
          background: "#444",
          borderRadius: "3px",
          color: "#fff",
          textDecoration: "none",
          fontSize: "11px"
        }}
        title="Sign out"
      >
        Logout
      </a>
    </div>
  );
}
