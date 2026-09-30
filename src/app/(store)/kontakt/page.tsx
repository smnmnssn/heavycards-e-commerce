import {
  InfoPlaceholderPage,
  infoPageMetadata,
} from "@/components/store/info-page";

export const metadata = infoPageMetadata("kontakt");

export default function Page() {
  return <InfoPlaceholderPage slug="kontakt" />;
}
