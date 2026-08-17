import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { mapAuthError } from "../lib/authErrors";
import { createUserProfile, getUserProfile } from "../services/usersService";
import type { UserProfile } from "../types/user";

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// Arranca en "loading: true" y "user: null": hasta que onAuthStateChanged no
// confirme el estado real de la sesión, no sabemos si hay alguien logueado o
// no. Tratar "user: null" como "no hay sesión" antes de esa confirmación
// causaría redirecciones incorrectas en ProtectedRoute/AdminRoute mientras
// Firebase todavía está resolviendo.
const initialState: AuthState = {
  user: null,
  loading: true,
  error: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  // "Generación" del evento de sesión vigente: onAuthStateChanged puede
  // disparar varias veces seguidas (ej. un logout inmediatamente después de
  // un login). Si la lectura async del perfil de una invocación vieja
  // resuelve después de que ya llegó un evento más nuevo, se descarta en vez
  // de pisar el estado con datos obsoletos. Mismo patrón que requestIdRef en
  // ProductsContext.
  const requestIdRef = useRef(0);

  // Único lugar de todo el archivo que llama a setState sobre "user": ni
  // signup, ni login, ni logout lo hacen directamente (ver más abajo). Así
  // el estado de sesión siempre refleja lo que Firebase Auth + Firestore
  // confirmaron, nunca un valor optimista armado a mano.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const myRequestId = ++requestIdRef.current;

      if (!firebaseUser) {
        setState({ user: null, loading: false, error: null });
        return;
      }

      try {
        const profile = await getUserProfile(firebaseUser.uid);
        if (myRequestId !== requestIdRef.current) return; // ya hay un evento más nuevo en curso

        if (!profile) {
          // Caso borde: Firebase Auth ya confirmó la sesión, pero el
          // documento de perfil en Firestore nunca apareció (ni con los
          // reintentos de getUserProfile). No se asume un rol por defecto:
          // se trata como "sin sesión válida" para toda la app, porque
          // ProtectedRoute, AdminRoute y Header dependen de "user" (nunca
          // de la sesión cruda de Firebase). La sesión de Firebase Auth
          // queda técnicamente activa en el navegador, pero es inofensiva:
          // no se fuerza un signOut() acá para evitar una carrera con este
          // mismo listener (signOut dispararía otro evento onAuthStateChanged
          // que podría pisar este mensaje de error). Detalle completo en
          // docs/auth-notes.md, sección "Caso borde".
          setState({
            user: null,
            loading: false,
            error: "No pudimos cargar tu perfil. Probá iniciar sesión de nuevo en unos segundos.",
          });
          return;
        }

        setState({ user: profile, loading: false, error: null });
      } catch (error) {
        if (myRequestId !== requestIdRef.current) return;
        setState({ user: null, loading: false, error: mapAuthError(error).message });
      }
    });

    return () => unsubscribe();
  }, []);

  // signup/login/logout NUNCA llaman a setState sobre "user": solo hablan
  // con el SDK de Firebase (y, en el caso de signup, con Firestore para
  // crear el perfil). Si fallan, relanzan el error ya traducido con
  // mapAuthError para que el formulario que las llamó lo muestre — el
  // listener de arriba es quien decide, siempre, cuál es el "user" vigente.
  const signup = useCallback(
    async (email: string, password: string, displayName: string): Promise<void> => {
      // credential vive fuera del try principal para saber, en el catch, si
      // la cuenta de Auth llegó a crearse (y por lo tanto hay que hacer
      // rollback) o si el signup falló antes de eso (nada que deshacer).
      let credential: Awaited<ReturnType<typeof createUserWithEmailAndPassword>> | undefined;
      try {
        credential = await createUserWithEmailAndPassword(auth, email, password);
        // Se guarda el nombre tanto en el perfil de Firebase Auth (updateProfile)
        // como en el documento de Firestore (createUserProfile): Auth es la fuente
        // de identidad, Firestore la fuente de datos de dominio (incluido el rol).
        // Mantener ambos sincronizados evita que "auth.currentUser.displayName"
        // y el perfil de la app queden desalineados.
        await updateProfile(credential.user, { displayName });
        await createUserProfile(credential.user.uid, { email, displayName });
      } catch (error) {
        // Si la cuenta de Auth ya se creó pero un paso posterior (updateProfile
        // o createUserProfile) falló, la cuenta queda "huérfana": sin perfil,
        // y el usuario no puede ni reintentar el signup (auth/email-already-in-use)
        // ni arreglarlo desde la UI. Por eso se hace rollback con deleteUser(),
        // dejando el email libre para un signup limpio. Si el rollback en sí
        // falla, NUNCA se oculta el error original: se loguea aparte y se
        // relanza igual el error que el usuario realmente necesita ver.
        if (credential) {
          try {
            await deleteUser(credential.user);
          } catch (rollbackError) {
            console.error("No se pudo revertir la cuenta tras un signup fallido:", rollbackError);
          }
        }
        // mapAuthError ya arma el AuthError completo ({ code, message, cause }).
        throw mapAuthError(error);
      }
    },
    []
  );

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      throw mapAuthError(error);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await signOut(auth);
    } catch (error) {
      throw mapAuthError(error);
    }
  }, []);

  // AuthContext lo consumen muchos componentes a la vez (Header, ProtectedRoute,
  // AdminRoute, LoginPage, SignupPage, etc.): memoizar el value evita que un
  // objeto nuevo en cada render del provider fuerce el re-render de todos ellos.
  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signup, login, logout }),
    [state, signup, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de un AuthProvider");
  }
  return context;
}
