import { POST as createSet } from "./create/route";
import { POST as updateSet } from "./update/route";

export async function POST(req: Request) {
  return createSet(req);
}

export async function PATCH(req: Request) {
  return updateSet(req);
}

export async function PUT(req: Request) {
  return updateSet(req);
}
