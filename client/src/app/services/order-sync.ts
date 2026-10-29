import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, catchError, exhaustMap, filter, fromEvent, interval, merge, of } from 'rxjs';

const CHECK_MS = 15000;

// Đồng bộ đơn hàng giữa khách và nhân viên (NFR-REL-06): hỏi phiên bản đơn mỗi 15 giây khi tab đang mở và ngay khi
// quay lại tab; phiên bản khác bản đang xem thì gọi changed(). Lỗi mạng bỏ qua, lần sau hỏi lại.
export function watchOrderVersion(opts: {
  check: () => Observable<{ version: string }>;
  current: () => string | null | undefined;
  changed: () => void;
  destroyRef: DestroyRef;
}): void {
  const visible = () => document.visibilityState === 'visible';
  merge(interval(CHECK_MS), fromEvent(document, 'visibilitychange'))
    .pipe(
      filter(() => visible() && !!opts.current()),
      exhaustMap(() => opts.check().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(opts.destroyRef),
    )
    .subscribe((r) => {
      if (r && opts.current() && r.version !== opts.current()) opts.changed();
    });
}

// Danh sách đơn làm mới khi quay lại tab
export function onTabVisible(destroyRef: DestroyRef, fn: () => void): void {
  fromEvent(document, 'visibilitychange')
    .pipe(
      filter(() => document.visibilityState === 'visible'),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe(fn);
}
