import {
  InfoPlaceholderPage,
  infoPageMetadata,
} from "@/components/store/info-page";

export const metadata = infoPageMetadata("cookiepolicy");

export default function Page() {
  return <InfoPlaceholderPage slug="cookiepolicy" />;
}
