type ProblemField = { field: string; message: string };

export function problem(
  status: number,
  title: string,
  detail: string,
  errors: ProblemField[] = [],
  type = "about:blank",
) {
  return { type, title, status, detail, errors };
}

/** Only fixed, user-safe messages belong here; never database errors or input values. */
export class ApiProblem extends Error {
  constructor(
    readonly statusCode: number,
    readonly title: string,
    readonly detail: string,
    readonly errors: ProblemField[] = [],
    /** A problem type for the few answers a client acts on (RFC 9457); every other problem keeps about:blank. */
    readonly type = "about:blank",
  ) {
    super(title);
  }
}
