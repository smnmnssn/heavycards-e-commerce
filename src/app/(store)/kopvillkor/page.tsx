import {
  InfoPlaceholderPage,
  infoPageMetadata,
} from "@/components/store/info-page";

export const metadata = infoPageMetadata("kopvillkor");

export default function Page() {
  return <InfoPlaceholderPage slug="kopvillkor" />;
}
