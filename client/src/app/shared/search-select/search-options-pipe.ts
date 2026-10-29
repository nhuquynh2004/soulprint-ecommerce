import { Pipe, PipeTransform } from '@angular/core';
import { SearchOption } from './search-select';

// Đổi danh sách sang lựa chọn của app-search-select:
// provinces() | searchOptions: 'code' : 'name'   (mảng object, chọn trường giá trị và trường tên)
// wards() | searchOptions                       (mảng chuỗi, giá trị = tên)
@Pipe({ name: 'searchOptions', standalone: false })
export class SearchOptionsPipe implements PipeTransform {
  transform(list: readonly unknown[] | null | undefined, valueKey?: string, labelKey?: string): SearchOption[] {
    return (list || []).map((x) => {
      if (typeof x === 'string') return { value: x, label: x };
      const o = x as Record<string, string | number>;
      return { value: o[valueKey || 'value'], label: String(o[labelKey || 'label']) };
    });
  }
}
