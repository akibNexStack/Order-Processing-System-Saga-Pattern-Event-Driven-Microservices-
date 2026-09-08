import { Icon } from "@/components/ui/icon";

export function PreviewNotice({ children }: { children: string }) {
  return (
    <div className="preview-notice">
      <Icon name="info" />
      <p>
        <strong>Workspace preview.</strong> {children}
      </p>
    </div>
  );
}
