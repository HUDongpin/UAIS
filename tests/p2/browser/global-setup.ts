import { resetP2FixtureData } from "./fixture-data";

export default async function globalSetup() {
  await resetP2FixtureData();
}
