"use client";

import { Button } from "./button";
import { Icon } from "./icon";

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn’t display this page. Please try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <span className="state-icon state-icon--error">
        <Icon name="alert" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
