export interface DesktopBridge { pickDirectory(): Promise<string | null>; readonly version: string }
declare global { interface Window { agentmanDesktop?: DesktopBridge } }
export function desktopBridge(): DesktopBridge | undefined {
  return typeof window.agentmanDesktop?.pickDirectory === 'function' ? window.agentmanDesktop : undefined;
}
