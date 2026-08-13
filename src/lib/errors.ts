export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const notFound = (message: string) => new AppError(404, 'not_found', message)
export const badRequest = (message: string) => new AppError(400, 'bad_request', message)
