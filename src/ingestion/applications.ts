import type { ApplicationInput } from './types'

export const DEMO_APPLICATIONS: ApplicationInput[] = [
  {
    name: 'payments-service',
    repository: 'acme/payments-service',
    packages: [{ ecosystem: 'npm', name: 'express', version: '5.2.1' }],
  },
  {
    name: 'auth-api',
    repository: 'acme/auth-api',
    packages: [{ ecosystem: 'npm', name: 'express', version: '5.2.1' }],
  },
  {
    name: 'reports-worker',
    repository: 'acme/reports-worker',
    packages: [{ ecosystem: 'npm', name: 'request', version: '2.88.2' }],
  },
  {
    name: 'legacy-processor',
    repository: 'acme/legacy-processor',
    packages: [{ ecosystem: 'npm', name: 'optimist', version: '0.6.1' }],
  },
  {
    name: 'ml-inference',
    repository: 'acme/ml-inference',
    packages: [{ ecosystem: 'PyPI', name: 'paramiko', version: '5.0.0' }],
  },
  {
    name: 'data-pipeline',
    repository: 'acme/data-pipeline',
    packages: [{ ecosystem: 'PyPI', name: 'matplotlib', version: '3.11.1' }],
  },
]
