import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { EMPTY, catchError, switchMap, tap } from 'rxjs';
import { CatalogApiService } from '../../services/catalog-apiservice';
import { IPolicy, POLICIES } from '../../classes/catalog';
import { ApiError } from '../../classes/api-error';

// SCR-30 Trang chính sách /chinh-sach/:slug (API-146): mục lục 6 trang bên trái, nội dung do Quản trị soạn bên phải.
@Component({
  selector: 'app-policy',
  standalone: false,
  templateUrl: './policy.html',
  styleUrl: './policy.scss',
})
export class Policy {
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly catalogApi = inject(CatalogApiService);

  readonly policies = POLICIES;
  readonly slug = signal('');
  readonly policy = signal<IPolicy | null>(null);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly notFound = signal(false);

  constructor() {
    this.route.paramMap
      .pipe(
        tap((params) => {
          this.slug.set(params.get('slug') || '');
          this.loading.set(true);
          this.errMessage.set('');
          this.notFound.set(false);
        }),
        switchMap(() =>
          this.catalogApi.getPolicy(this.slug()).pipe(
            catchError((err: ApiError) => {
              this.loading.set(false);
              this.policy.set(null);
              if (err.status === 404) this.notFound.set(true);
              else this.errMessage.set('Không tải được nội dung. Thử lại');
              this.title.setTitle('Chính sách - Soulprint');
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((p) => {
        this.policy.set(p);
        this.loading.set(false);
        this.title.setTitle(`${p.title} - Soulprint`);
      });
  }

  reload(): void {
    this.catalogApi.getPolicy(this.slug()).subscribe({
      next: (p) => {
        this.policy.set(p);
        this.errMessage.set('');
      },
      error: () => this.errMessage.set('Không tải được nội dung. Thử lại'),
    });
  }
}
