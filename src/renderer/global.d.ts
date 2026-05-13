import type { ResumeApi } from "../main/preload";

declare global {
  interface Window {
    resume: ResumeApi;
    resumeDevPreview?: boolean;
  }
}
