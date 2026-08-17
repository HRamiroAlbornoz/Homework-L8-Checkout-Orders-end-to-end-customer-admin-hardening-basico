import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { User } from "firebase/auth";
import { AuthProvider, useAuth } from "./AuthContext";
import type { UserProfile } from "../types/user";

// Nunca tocamos Firebase real. Mockeamos solo las funciones del SDK que usa
// AuthContext; el resto del módulo (incluida la clase FirebaseError, que
// necesitamos para simular errores reales) queda real.
vi.mock("firebase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/auth")>();
  return {
    ...actual,
    onAuthStateChanged: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    updateProfile: vi.fn(),
    deleteUser: vi.fn(),
  };
});

vi.mock("../lib/firebase", () => ({ auth: {} }));

vi.mock("../services/usersService", () => ({
  getUserProfile: vi.fn(),
  createUserProfile: vi.fn(),
}));

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  deleteUser,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth } from "../lib/firebase";
import { getUserProfile, createUserProfile } from "../services/usersService";

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

function fakeFirebaseUser(uid: string): User {
  return { uid } as User;
}

const sampleProfile: UserProfile = {
  uid: "uid-1",
  email: "hernan@example.com",
  displayName: "Hernán",
  role: "customer",
  // El valor exacto no importa para estos tests: AuthContext nunca inspecciona
  // createdAt, solo lo transporta tal como lo devuelve getUserProfile (mockeado).
  createdAt: {} as UserProfile["createdAt"],
};

describe("useAuth guard", () => {
  it("tira un error claro si se usa fuera de AuthProvider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useAuth())).toThrow("useAuth debe usarse dentro de un AuthProvider");

    consoleError.mockRestore();
  });
});

describe("AuthContext", () => {
  let authStateCallback: (user: User | null) => Promise<void> | void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (onAuthStateChanged as Mock).mockImplementation((_auth: unknown, callback: typeof authStateCallback) => {
      authStateCallback = callback;
      return unsubscribe;
    });
  });

  it("arranca en loading: true y user: null antes de que Firebase confirme la sesión", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("se suscribe a onAuthStateChanged sobre la instancia de auth al montar", () => {
    renderHook(() => useAuth(), { wrapper });

    expect(onAuthStateChanged).toHaveBeenCalledWith(auth, expect.any(Function));
  });

  it("se desuscribe al desmontar (llama a la función que devuelve onAuthStateChanged)", () => {
    const { unmount } = renderHook(() => useAuth(), { wrapper });

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("cuando Firebase confirma que no hay sesión, pasa a loading: false y user: null", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await authStateCallback(null);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("cuando Firebase confirma un usuario con perfil en Firestore, carga el perfil completo (con role)", async () => {
    (getUserProfile as Mock).mockResolvedValueOnce(sampleProfile);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await authStateCallback(fakeFirebaseUser("uid-1"));
    });

    expect(getUserProfile).toHaveBeenCalledWith("uid-1");
    expect(result.current.user).toEqual(sampleProfile);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("caso borde: usuario autenticado sin perfil en Firestore (getUserProfile devuelve null) trata la sesión como inválida, sin asumir un rol", async () => {
    (getUserProfile as Mock).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await authStateCallback(fakeFirebaseUser("uid-huerfano"));
    });

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("caso borde: no fuerza un signOut() al no encontrar perfil (evita competir con este mismo listener)", async () => {
    (getUserProfile as Mock).mockResolvedValueOnce(null);
    renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await authStateCallback(fakeFirebaseUser("uid-huerfano"));
    });

    expect(signOut).not.toHaveBeenCalled();
  });

  it("si getUserProfile falla, guarda el mensaje de error mapeado en español (no el técnico crudo)", async () => {
    (getUserProfile as Mock).mockRejectedValueOnce(new Error("permission-denied"));
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await authStateCallback(fakeFirebaseUser("uid-1"));
    });

    expect(result.current.user).toBeNull();
    expect(result.current.error).toBe("Ocurrió un error inesperado. Intentá de nuevo.");
  });

  it("signup llama a createUserWithEmailAndPassword, updateProfile y createUserProfile con los datos correctos", async () => {
    (createUserWithEmailAndPassword as Mock).mockResolvedValueOnce({ user: fakeFirebaseUser("uid-nuevo") });
    (updateProfile as Mock).mockResolvedValueOnce(undefined);
    (createUserProfile as Mock).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signup("nueva@example.com", "clave123", "Persona Nueva");
    });

    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(auth, "nueva@example.com", "clave123");
    expect(updateProfile).toHaveBeenCalledWith(
      { uid: "uid-nuevo" },
      { displayName: "Persona Nueva" }
    );
    expect(createUserProfile).toHaveBeenCalledWith("uid-nuevo", {
      email: "nueva@example.com",
      displayName: "Persona Nueva",
    });
  });

  it("signup NUNCA actualiza 'user' por su cuenta: el estado sigue igual hasta que onAuthStateChanged dispare", async () => {
    (getUserProfile as Mock).mockResolvedValueOnce(sampleProfile);
    const { result } = renderHook(() => useAuth(), { wrapper });

    // Sesión ya establecida por el listener (simulando que ya había alguien logueado).
    await act(async () => {
      await authStateCallback(fakeFirebaseUser("uid-1"));
    });
    const userAntes = result.current.user;

    (createUserWithEmailAndPassword as Mock).mockResolvedValueOnce({ user: fakeFirebaseUser("uid-otro") });
    (updateProfile as Mock).mockResolvedValueOnce(undefined);
    (createUserProfile as Mock).mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.signup("otra@example.com", "clave123", "Otra Persona");
    });

    // signup() se ejecutó, pero como el mock de onAuthStateChanged no volvió a
    // disparar, "user" tiene que seguir siendo exactamente el mismo (misma
    // referencia): la prueba de que signup no llama a setState sobre "user".
    expect(result.current.user).toBe(userAntes);
  });

  it("signup propaga el mensaje de error en español si el email ya está en uso", async () => {
    (createUserWithEmailAndPassword as Mock).mockRejectedValueOnce(
      new FirebaseError("auth/email-already-in-use", "Firebase: Error (auth/email-already-in-use).")
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signup("repetida@example.com", "clave123", "Alguien");
      })
    ).rejects.toThrow("Ya existe una cuenta registrada con ese email.");
  });

  it("signup propaga un error mapeado si createUserProfile falla después de crear la cuenta en Auth", async () => {
    (createUserWithEmailAndPassword as Mock).mockResolvedValueOnce({ user: fakeFirebaseUser("uid-nuevo") });
    (updateProfile as Mock).mockResolvedValueOnce(undefined);
    (createUserProfile as Mock).mockRejectedValueOnce(new Error("Error desconocido al crear el perfil de usuario"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signup("nueva@example.com", "clave123", "Persona Nueva");
      })
    ).rejects.toThrow("Ocurrió un error inesperado. Intentá de nuevo.");
  });

  it("si createUserProfile falla después de crear la cuenta en Auth, hace rollback llamando a deleteUser (evita una cuenta huérfana)", async () => {
    const nuevoUsuario = fakeFirebaseUser("uid-nuevo");
    (createUserWithEmailAndPassword as Mock).mockResolvedValueOnce({ user: nuevoUsuario });
    (updateProfile as Mock).mockResolvedValueOnce(undefined);
    (createUserProfile as Mock).mockRejectedValueOnce(new Error("permission-denied"));
    (deleteUser as Mock).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signup("nueva@example.com", "clave123", "Persona Nueva");
      })
    ).rejects.toThrow();

    expect(deleteUser).toHaveBeenCalledWith(nuevoUsuario);
  });

  it("si updateProfile falla, también hace rollback llamando a deleteUser", async () => {
    const nuevoUsuario = fakeFirebaseUser("uid-nuevo");
    (createUserWithEmailAndPassword as Mock).mockResolvedValueOnce({ user: nuevoUsuario });
    (updateProfile as Mock).mockRejectedValueOnce(new Error("network-error"));
    (deleteUser as Mock).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signup("nueva@example.com", "clave123", "Persona Nueva");
      })
    ).rejects.toThrow();

    expect(deleteUser).toHaveBeenCalledWith(nuevoUsuario);
  });

  it("si createUserWithEmailAndPassword falla directamente, NO intenta ningún rollback (no hay cuenta que borrar)", async () => {
    (createUserWithEmailAndPassword as Mock).mockRejectedValueOnce(
      new FirebaseError("auth/email-already-in-use", "Firebase: Error (auth/email-already-in-use).")
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signup("repetida@example.com", "clave123", "Alguien");
      })
    ).rejects.toThrow();

    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("si el rollback (deleteUser) también falla, igual propaga el error ORIGINAL del signup, sin ocultarlo", async () => {
    const nuevoUsuario = fakeFirebaseUser("uid-nuevo");
    (createUserWithEmailAndPassword as Mock).mockResolvedValueOnce({ user: nuevoUsuario });
    (updateProfile as Mock).mockResolvedValueOnce(undefined);
    (createUserProfile as Mock).mockRejectedValueOnce(new Error("permission-denied"));
    (deleteUser as Mock).mockRejectedValueOnce(new Error("auth/requires-recent-login"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.signup("nueva@example.com", "clave123", "Persona Nueva");
      })
    ).rejects.toThrow("Ocurrió un error inesperado. Intentá de nuevo.");

    expect(deleteUser).toHaveBeenCalledWith(nuevoUsuario);
    consoleError.mockRestore();
  });

  it("login llama a signInWithEmailAndPassword con los datos correctos", async () => {
    (signInWithEmailAndPassword as Mock).mockResolvedValueOnce({ user: fakeFirebaseUser("uid-1") });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login("hernan@example.com", "clave123");
    });

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(auth, "hernan@example.com", "clave123");
  });

  it("login NUNCA actualiza 'user' por su cuenta", async () => {
    (getUserProfile as Mock).mockResolvedValueOnce(sampleProfile);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await authStateCallback(fakeFirebaseUser("uid-1"));
    });
    const userAntes = result.current.user;

    (signInWithEmailAndPassword as Mock).mockResolvedValueOnce({ user: fakeFirebaseUser("uid-1") });

    await act(async () => {
      await result.current.login("hernan@example.com", "clave123");
    });

    expect(result.current.user).toBe(userAntes);
  });

  it("login propaga 'Email o contraseña incorrectos' ante auth/invalid-credential, sin revelar si el email existe", async () => {
    (signInWithEmailAndPassword as Mock).mockRejectedValueOnce(
      new FirebaseError("auth/invalid-credential", "Firebase: Error (auth/invalid-credential).")
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.login("hernan@example.com", "clave-incorrecta");
      })
    ).rejects.toThrow("Email o contraseña incorrectos.");
  });

  it("logout llama a signOut sobre la instancia de auth", async () => {
    (signOut as Mock).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.logout();
    });

    expect(signOut).toHaveBeenCalledWith(auth);
  });

  it("logout NUNCA actualiza 'user' por su cuenta", async () => {
    (getUserProfile as Mock).mockResolvedValueOnce(sampleProfile);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await authStateCallback(fakeFirebaseUser("uid-1"));
    });
    const userAntes = result.current.user;

    (signOut as Mock).mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBe(userAntes);
  });

  it("logout propaga un error mapeado si signOut falla", async () => {
    (signOut as Mock).mockRejectedValueOnce(new Error("network fallo"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.logout();
      })
    ).rejects.toThrow("Ocurrió un error inesperado. Intentá de nuevo.");
  });

  it("descarta una resolución vieja de getUserProfile si llega un evento más nuevo de onAuthStateChanged (anti-race-condition)", async () => {
    let resolveOld!: (value: UserProfile | null) => void;
    const oldProfileLookup = new Promise<UserProfile | null>((resolve) => {
      resolveOld = resolve;
    });
    (getUserProfile as Mock).mockReturnValueOnce(oldProfileLookup);

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Evento viejo: login de "uid-1", queda "en vuelo" esperando su perfil.
    let oldEvent!: Promise<void> | void;
    act(() => {
      oldEvent = authStateCallback(fakeFirebaseUser("uid-1")) as Promise<void>;
    });

    // Evento nuevo: mientras tanto, Firebase notifica que la sesión se cerró.
    await act(async () => {
      await authStateCallback(null);
    });
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);

    // Recién ahora resuelve el perfil del evento viejo: no debe revivir la sesión.
    await act(async () => {
      resolveOld(sampleProfile);
      await oldEvent;
    });

    expect(result.current.user).toBeNull();
  });
});
