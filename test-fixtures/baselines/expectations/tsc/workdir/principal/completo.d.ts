interface UserProfile {
    readonly id: string | number;
    name: string;
    age?: number;
    role: UserRole;
}
declare enum UserRole {
    Admin = "ADMIN",
    Editor = "EDITOR",
    Viewer = "VIEWER"
}
export declare const VERSION: number;
export type { UserProfile };
