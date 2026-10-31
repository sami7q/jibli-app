-- Main sections above a menu's categories.
--
-- A restaurant like 10:10 has twenty categories — salads, pizza, waffles,
-- milkshakes… — and a single strip of twenty small tabs was hard to read and
-- did not say what kind of thing each was. Shops now group their categories
-- under a few main sections («الأطعمة», «المشروبات», «الحلويات»), shown as a
-- top-level bar in the app with the categories beneath.
--
-- Free text on the category rather than a table of its own: three or four
-- words per shop, edited in the same form as the category name. Nullable, so
-- every existing menu stays flat until its shop chooses sections.
ALTER TABLE menu_categories
  ADD COLUMN section_ar text;
