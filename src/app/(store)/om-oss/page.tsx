import {
  InfoPlaceholderPage,
  infoPageMetadata,
} from "@/components/store/info-page";

export const metadata = infoPageMetadata("om-oss");

export default function Page() {
  return <InfoPlaceholderPage slug="om-oss" />;
}
