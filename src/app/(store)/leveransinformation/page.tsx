import {
  InfoPlaceholderPage,
  infoPageMetadata,
} from "@/components/store/info-page";

export const metadata = infoPageMetadata("leveransinformation");

export default function Page() {
  return <InfoPlaceholderPage slug="leveransinformation" />;
}
