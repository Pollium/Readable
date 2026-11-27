// The page files of the apps that mount Readable today (Condor, Learn's admin, Modafinil, Sentinel), as
// their import.meta.glob lists them, and whether they give mount() a layout. A change to how pages turn
// into routes is checked against the routes these apps got before it.
export interface AppPages{
    layout: boolean;
    files: readonly string[];
}

export const apps: Record<string, AppPages> = {
    condor: {
        layout: true,
        files: [
            '/src/modules/account/pages/protected/cuenta/index.tsx',
            '/src/modules/auth/pages/guest/configurar/index.tsx',
            '/src/modules/auth/pages/guest/entrar/index.tsx',
            '/src/modules/auth/pages/guest/invitacion/[token]/index.tsx',
            '/src/modules/events/pages/protected/[projectId]/eventos/index.tsx',
            '/src/modules/funnels/pages/protected/[projectId]/embudos/index.tsx',
            '/src/modules/heatmaps/pages/protected/[projectId]/mapas-de-calor/index.tsx',
            '/src/modules/issues/pages/protected/[projectId]/errores/index.tsx',
            '/src/modules/journeys/pages/protected/[projectId]/recorridos/index.tsx',
            '/src/modules/overview/pages/protected/[projectId]/index.tsx',
            '/src/modules/projects/pages/protected/[projectId]/ajustes/index.tsx',
            '/src/modules/projects/pages/protected/index.tsx',
            '/src/modules/retention/pages/protected/[projectId]/retencion/index.tsx',
            '/src/modules/sessions/pages/protected/[projectId]/sesiones/[sessionId]/index.tsx',
            '/src/modules/sessions/pages/protected/[projectId]/sesiones/index.tsx',
            '/src/modules/team/pages/protected/equipo/index.tsx'
        ]
    },
    learnAdmin: {
        layout: true,
        files: [
            '/src/modules/admin/pages/protected/Content/Bucket/index.tsx',
            '/src/modules/admin/pages/protected/Content/Files/[fileId]/index.tsx',
            '/src/modules/admin/pages/protected/Content/Videos/index.tsx',
            '/src/modules/admin/pages/protected/Content/index.tsx',
            '/src/modules/admin/pages/protected/Content/library/index.tsx',
            '/src/modules/admin/pages/protected/Courses/[id]/index.tsx',
            '/src/modules/admin/pages/protected/Courses/index.tsx',
            '/src/modules/admin/pages/protected/Courses/layout.tsx',
            '/src/modules/admin/pages/protected/Explorer/[collection]/index.tsx',
            '/src/modules/admin/pages/protected/Explorer/index.tsx',
            '/src/modules/admin/pages/protected/Jobs/[id]/index.tsx',
            '/src/modules/admin/pages/protected/Jobs/index.tsx',
            '/src/modules/admin/pages/protected/Jobs/layout.tsx',
            '/src/modules/admin/pages/protected/Jobs/queue/index.tsx',
            '/src/modules/admin/pages/protected/Learners/[userId]/index.tsx',
            '/src/modules/admin/pages/protected/Learners/index.tsx',
            '/src/modules/admin/pages/protected/Learners/layout.tsx',
            '/src/modules/admin/pages/protected/Overview/[topic]/index.tsx',
            '/src/modules/admin/pages/protected/Overview/index.tsx',
            '/src/modules/admin/pages/protected/Reports/[id]/index.tsx',
            '/src/modules/admin/pages/protected/Reports/index.tsx',
            '/src/modules/admin/pages/protected/Reports/layout.tsx',
            '/src/modules/admin/pages/protected/Settings/Billing/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Limits/Materials/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Limits/Practice/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Limits/Runtime/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Limits/Speech/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Limits/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Mail/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Plans/Preferences/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Plans/Subscriptions/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Providers/Mcp/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Providers/Voice/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Providers/index.tsx',
            '/src/modules/admin/pages/protected/Settings/Staff/index.tsx',
            '/src/modules/admin/pages/protected/Settings/index.tsx',
            '/src/modules/admin/pages/protected/index.tsx',
            '/src/modules/auth/pages/guest/SignIn/index.tsx',
            '/src/modules/auth/pages/public/Auth/Callback/index.tsx'
        ]
    },
    modafinil: {
        layout: false,
        files: [
            '/src/modules/status/pages/public/index.tsx'
        ]
    },
    sentinel: {
        layout: true,
        files: [
            '/src/modules/auth/pages/guest/Invitations/[token]/index.tsx',
            '/src/modules/auth/pages/guest/Setup/index.tsx',
            '/src/modules/auth/pages/guest/SignIn/index.tsx',
            '/src/modules/auth/pages/public/*/index.tsx',
            '/src/modules/operators/pages/protected/Operators/index.tsx',
            '/src/modules/tower/pages/protected/Keys/[id]/index.tsx',
            '/src/modules/tower/pages/protected/Keys/all/index.tsx',
            '/src/modules/tower/pages/protected/Keys/index.tsx',
            '/src/modules/tower/pages/protected/Keys/layout.tsx',
            '/src/modules/tower/pages/protected/Models/[model]/index.tsx',
            '/src/modules/tower/pages/protected/Models/all/index.tsx',
            '/src/modules/tower/pages/protected/Models/index.tsx',
            '/src/modules/tower/pages/protected/Models/layout.tsx',
            '/src/modules/tower/pages/protected/Overview/index.tsx',
            '/src/modules/tower/pages/protected/Providers/[id]/index.tsx',
            '/src/modules/tower/pages/protected/Providers/all/index.tsx',
            '/src/modules/tower/pages/protected/Providers/index.tsx',
            '/src/modules/tower/pages/protected/Providers/layout.tsx',
            '/src/modules/tower/pages/protected/index.tsx'
        ]
    }
};
