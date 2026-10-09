export type ProblemField = { field: string; message: string };

export function problem(
  status: number,
  title: string,
  detail: string,
  errors: ProblemField[] = [],
) {
  return { type: "about:blank", title, status, detail, errors };
}

/** Only fixed, user-safe messages belong here; never database errors or input values. */
export class ApiProblem extends Error {
  constructor(
    readonly statusCode: number,
    readonly title: string,
    readonly detail: string,
    readonly errors: ProblemField[] = [],
  ) {
    super(title);
  }
}
