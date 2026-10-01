import { ButtonLink } from "@/components/ui/button";

import { AuthCard } from "./auth-card";

/** Shown for unusable invitation or reset links; never says why. */
export function InvalidLinkNotice({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action: { label: string; href: string };
}) {
  return (
    <AuthCard title={title} description={<p>{text}</p>}>
      <ButtonLink href={action.href} variant="secondary" fullWidth>
        {action.label}
      </ButtonLink>
    </AuthCard>
  );
}
