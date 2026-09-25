import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Sidebar, NoopAnimationsModule],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Sidebar);
    fixture.componentRef.setInput('title', "Fabio's Blog");

    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the title in the toolbar', () => {
    const fixture = TestBed.createComponent(Sidebar);
    fixture.componentRef.setInput('title', "Fabio's Blog");

    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-link')?.textContent).toContain("Fabio's Blog");
  });

  it('shows the login link but hides authenticated-only links when logged out', () => {
    const fixture = TestBed.createComponent(Sidebar);
    fixture.componentRef.setInput('title', "Fabio's Blog");
    fixture.componentRef.setInput('authEnabled', true);
    fixture.componentRef.setInput('isAuthenticated', false);

    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="login-link"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="logout"]')).toBeFalsy();
  });
});
