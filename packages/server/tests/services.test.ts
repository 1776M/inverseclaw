import { describe, it, expect } from 'vitest';
import { loadServices } from '../src/services.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function writeTempYaml(content: string): string {
  const dir = join(tmpdir(), `ic-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'services.yaml');
  writeFileSync(file, content, 'utf-8');
  return file;
}

describe('loadServices', () => {
  it('should load valid services.yaml', () => {
    const file = writeTempYaml(`
services:
  - name: Oven Cleaning
    description: Professional oven cleaning service
    service_area:
      country: GB
      regions: [M, SK]
`);
    const services = loadServices(file);
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe('Oven Cleaning');
    expect(services[0].service_area?.country).toBe('GB');
    expect(services[0].service_area?.regions).toEqual(['M', 'SK']);
  });

  it('should load multiple services', () => {
    const file = writeTempYaml(`
services:
  - name: Service A
    description: Description A
  - name: Service B
    description: Description B
`);
    const services = loadServices(file);
    expect(services).toHaveLength(2);
  });

  it('should allow services without service_area', () => {
    const file = writeTempYaml(`
services:
  - name: Remote Consulting
    description: We do consulting remotely, anywhere
`);
    const services = loadServices(file);
    expect(services).toHaveLength(1);
    expect(services[0].service_area).toBeUndefined();
  });

  it('should throw on empty services array', () => {
    const file = writeTempYaml(`
services: []
`);
    expect(() => loadServices(file)).toThrow('Invalid services.yaml');
  });

  it('should throw on missing name', () => {
    const file = writeTempYaml(`
services:
  - description: No name here
`);
    expect(() => loadServices(file)).toThrow('Invalid services.yaml');
  });

  it('should throw on missing description', () => {
    const file = writeTempYaml(`
services:
  - name: No Description
`);
    expect(() => loadServices(file)).toThrow('Invalid services.yaml');
  });

  it('should throw on missing file', () => {
    expect(() => loadServices('/nonexistent/path/services.yaml')).toThrow(
      'Could not read services file'
    );
  });
});
