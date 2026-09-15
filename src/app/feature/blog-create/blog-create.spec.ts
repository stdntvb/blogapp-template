import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BlogCreate } from './blog-create';

describe('BlogCreate', () => {
  let component: BlogCreate;
  let fixture: ComponentFixture<BlogCreate>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BlogCreate],
    }).compileComponents();

    fixture = TestBed.createComponent(BlogCreate);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function getElement<T extends HTMLElement>(testId: string): T {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function setFieldValue(testId: string, value: string): Promise<void> {
    const element = getElement<HTMLInputElement | HTMLTextAreaElement>(testId);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    element.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show required error when title is left empty', async () => {
    await setFieldValue('blog-create-title', '');

    const errors = getElement<HTMLUListElement>('blog-create-title-errors');
    expect(errors).toBeTruthy();
    expect(errors?.textContent).toContain('Titel ist erforderlich');
  });

  it('should show minLength error when title is too short', async () => {
    await setFieldValue('blog-create-title', 'ab');

    const errors = getElement<HTMLUListElement>('blog-create-title-errors');
    expect(errors?.textContent).toContain('mindestens 3 Zeichen');
  });

  it('should show maxLength error when title exceeds 100 characters', async () => {
    await setFieldValue('blog-create-title', 'a'.repeat(101));

    const errors = getElement<HTMLUListElement>('blog-create-title-errors');
    expect(errors?.textContent).toContain('maximal 100 Zeichen');
  });

  it('should show custom validator error when title contains special characters', async () => {
    await setFieldValue('blog-create-title', 'Titel!@#');

    const errors = getElement<HTMLUListElement>('blog-create-title-errors');
    expect(errors?.textContent).toContain(
      'Titel darf nur Buchstaben, Zahlen und Leerzeichen enthalten',
    );
  });

  it('should not show a special-chars error for a valid title', async () => {
    await setFieldValue('blog-create-title', 'Ein gültiger Titel');

    const errors = getElement<HTMLUListElement>('blog-create-title-errors');
    expect(errors).toBeFalsy();
  });

  it('should show cross-field error when content is shorter than twice the title length', async () => {
    await setFieldValue('blog-create-title', 'Ein langer Titel');
    await setFieldValue('blog-create-content', 'Zu kurz');

    const errors = getElement<HTMLUListElement>('blog-create-content-errors');
    expect(errors?.textContent).toContain(
      'Inhalt muss mindestens doppelt so lang wie der Titel sein',
    );
  });

  it('should not show the cross-field error once content is long enough', async () => {
    await setFieldValue('blog-create-title', 'Titel');
    await setFieldValue('blog-create-content', 'Dies ist ein ausreichend langer Inhaltstext.');

    const errors = getElement<HTMLUListElement>('blog-create-content-errors');
    expect(errors).toBeFalsy();
  });

  it('should disable the submit button while the form is invalid', () => {
    const submitButton = getElement<HTMLButtonElement>('blog-create-submit');

    expect(submitButton.disabled).toBe(true);
  });

  it('should enable the submit button once the form is valid', async () => {
    await setFieldValue('blog-create-title', 'Titel');
    await setFieldValue('blog-create-content', 'Dies ist ein ausreichend langer Inhaltstext.');

    const submitButton = getElement<HTMLButtonElement>('blog-create-submit');
    expect(submitButton.disabled).toBe(false);
  });
});
