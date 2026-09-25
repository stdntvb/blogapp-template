import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  FormField,
  form,
  maxLength,
  minLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';

interface BlogCreateModel {
  title: string;
  content: string;
  category: string;
}

// Buchstaben (inkl. Umlaute/ß via \p{L}), Zahlen und Leerzeichen sind erlaubt.
const TITLE_WITHOUT_SPECIAL_CHARS = /^[\p{L}\p{N}\s]*$/u;

@Component({
  selector: 'app-blog-create',
  imports: [FormField],
  templateUrl: './blog-create.html',
  styleUrl: './blog-create.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlogCreate {
  protected readonly blogModel = signal<BlogCreateModel>({
    title: '',
    content: '',
    category: 'general',
  });

  protected readonly submitting = signal(false);

  protected readonly blogForm = form(this.blogModel, (s) => {
    // --- Aufgabe 2: Built-in Validators ---
    required(s.title, { message: 'Titel ist erforderlich' });
    minLength(s.title, 3, { message: 'Titel muss mindestens 3 Zeichen lang sein' });
    maxLength(s.title, 100, { message: 'Titel darf maximal 100 Zeichen lang sein' });

    required(s.content, { message: 'Inhalt ist erforderlich' });
    minLength(s.content, 10, { message: 'Inhalt muss mindestens 10 Zeichen lang sein' });

    required(s.category, { message: 'Kategorie ist erforderlich' });

    // --- Aufgabe 3a: Custom Validator (Titel ohne Sonderzeichen) ---
    validate(s.title, ({ value }) => {
      if (!TITLE_WITHOUT_SPECIAL_CHARS.test(value())) {
        return {
          kind: 'specialChars',
          message: 'Titel darf nur Buchstaben, Zahlen und Leerzeichen enthalten',
        };
      }
      return null;
    });

    // --- Aufgabe 3b: Cross-Field Validator (Inhalt >= 2x Titel-Länge) ---
    validate(s.content, ({ value, valueOf }) => {
      const content = value();
      const title = valueOf(s.title);

      if (content.length > 0 && content.length < title.length * 2) {
        return {
          kind: 'contentTooShort',
          message: 'Inhalt muss mindestens doppelt so lang wie der Titel sein',
        };
      }
      return null;
    });
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();

    await submit(this.blogForm, async () => {
      this.submitting.set(true);

      try {
        // Hier würde normalerweise this.blogService.createBlog(...) aufgerufen werden.
        console.log('Neuer Blog-Beitrag:', this.blogModel());
      } finally {
        this.submitting.set(false);
      }
    });
  }
}
