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
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
