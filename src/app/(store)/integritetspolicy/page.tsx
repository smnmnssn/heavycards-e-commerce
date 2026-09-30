import {
  InfoPlaceholderPage,
  infoPageMetadata,
} from "@/components/store/info-page";

export const metadata = infoPageMetadata("integritetspolicy");

export default function Page() {
  return <InfoPlaceholderPage slug="integritetspolicy" />;
}
