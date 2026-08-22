import { removeP2FixtureData } from "./fixture-data";

export default async function globalTeardown() {
  await removeP2FixtureData();
}
