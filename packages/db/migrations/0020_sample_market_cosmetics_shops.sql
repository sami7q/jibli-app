-- Sample market and cosmetics shops, so the two non-food sections are not empty.
--
-- Production had six restaurants in Baghdad and nothing else: no market and no
-- cosmetics shop in either open city, so both new sections rendered «لا متاجر».
-- The demo seed refuses production and the one-off script needs a connection
-- string only Render holds, so the shops arrive the way the schema does — as a
-- migration the API applies on boot.
--
--   Baghdad: two markets, two cosmetics shops
--   Haditha: one market, one cosmetics shop
--
-- Each shop is skipped if its partner code already exists or its city is
-- missing, so this is safe on any database. They carry the DEMO- partner code,
-- so `pnpm db:remove-demo` takes them out again once real shops join. Owner
-- passwords are stored only as argon2 hashes; the plaintext was handed over
-- once, outside the repository.

-- ماركت الرشيد (MARKET, IQ-BG-BAGHDAD)
DO $$
DECLARE
  v_city uuid;
  v_gov uuid;
  v_provider uuid := gen_random_uuid();
  v_rest uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_user uuid;
  v_cat uuid;
BEGIN
  SELECT id, governorate_id INTO v_city, v_gov FROM cities WHERE code = 'IQ-BG-BAGHDAD';
  IF v_city IS NULL OR EXISTS (SELECT 1 FROM restaurants WHERE partner_code = 'DEMO-2001') THEN
    RETURN;
  END IF;

  INSERT INTO providers (id, provider_type, status) VALUES (v_provider, 'RESTAURANT', 'ACTIVE');

  INSERT INTO restaurants (id, provider_id, display_name, legal_name, partner_code, description_ar,
      cuisine_tags, merchant_type, onboarding_status, operational_status, minimum_order_iqd,
      rating_average, rating_count, approved_at)
    VALUES (v_rest, v_provider, 'ماركت الرشيد', 'ماركت الرشيد', 'DEMO-2001', 'بقالة ومواد غذائية، توصيل سريع لكل ما ينقص البيت.',
      '["grocery","mk_dairy","mk_produce","mk_household"]'::jsonb, 'MARKET', 'APPROVED', 'ACTIVE', 5000,
      4.5, 186, now());

  INSERT INTO restaurant_branches (id, restaurant_id, name, governorate_id, city_id, address_text,
      district_text, phone, is_active, accepts_orders, busy_mode, base_preparation_minutes, delivery_fee_iqd)
    VALUES (v_branch, v_rest, 'الفرع الرئيسي', v_gov, v_city, 'شارع فلسطين، حي البنوك', 'البنوك',
      '+9647701110007', true, true, 'NORMAL', 10, 1500);

  INSERT INTO branch_working_hours (id, branch_id, day_of_week, opens_at_minute, closes_at_minute, is_closed)
    VALUES
      (gen_random_uuid(), v_branch, 0, 0, 1440, false),
      (gen_random_uuid(), v_branch, 1, 0, 1440, false),
      (gen_random_uuid(), v_branch, 2, 0, 1440, false),
      (gen_random_uuid(), v_branch, 3, 0, 1440, false),
      (gen_random_uuid(), v_branch, 4, 0, 1440, false),
      (gen_random_uuid(), v_branch, 5, 0, 1440, false),
      (gen_random_uuid(), v_branch, 6, 0, 1440, false);

  INSERT INTO restaurant_commission_configs (id, restaurant_id, commission_flat_iqd, settlement_policy,
      payment_term_days, effective_from, note)
    VALUES (gen_random_uuid(), v_rest, 500, 'HALF_MONTH', 7, now() - interval '1 day', 'Sample shop default');

  SELECT id INTO v_user FROM users WHERE lower(username) = lower('demo.market');
  IF v_user IS NULL THEN
    v_user := gen_random_uuid();
    INSERT INTO users (id, username, full_name, password_hash, must_change_password, status)
      VALUES (v_user, 'demo.market', 'أبو أحمد الرشيد', '$argon2id$v=19$m=19456,t=2,p=1$UciuuVy4a7+LJZlGy/sCmA$LkueHfFnAi4KODwkI5fdtsvfWAZlYJe7db4kXCk++4g', false, 'ACTIVE');
  ELSE
    UPDATE users SET password_hash = '$argon2id$v=19$m=19456,t=2,p=1$UciuuVy4a7+LJZlGy/sCmA$LkueHfFnAi4KODwkI5fdtsvfWAZlYJe7db4kXCk++4g', status = 'ACTIVE', updated_at = now() WHERE id = v_user;
  END IF;

  INSERT INTO restaurant_members (id, restaurant_id, user_id, role, is_active)
    VALUES (gen_random_uuid(), v_rest, v_user, 'OWNER', true);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'ألبان وأجبان', 'مبرّدة، تصل باردة', 0, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'حليب طازج ١ لتر', 'مبستر، كامل الدسم', 2000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'لبن رائب ٥٠٠ غم', NULL, 1500, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'جبن أبيض ٤٠٠ غم', NULL, 4500, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'زبدة ٢٠٠ غم', NULL, 3500, true, 3, false),
        (gen_random_uuid(), v_rest, v_cat, 'بيض طازج ٣٠ حبة', 'محلي', 7000, true, 4, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'مواد غذائية أساسية', NULL, 1, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'رز بسمتي ٥ كغم', NULL, 12000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'سكر ٢ كغم', NULL, 2500, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'زيت دوار الشمس ١.٨ لتر', NULL, 6500, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'طحين ٥ كغم', NULL, 5000, true, 3, false),
        (gen_random_uuid(), v_rest, v_cat, 'معجون طماطم ٨٠٠ غم', NULL, 3000, true, 4, false),
        (gen_random_uuid(), v_rest, v_cat, 'شاي أسود ٤٠٠ غم', 'سيلاني', 5500, true, 5, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'خضار وفواكه', 'من سوق الجملة كل صباح', 2, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'طماطم ١ كغم', NULL, 1500, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'خيار ١ كغم', NULL, 1250, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'بصل ١ كغم', NULL, 1000, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'بطاطا ٢ كغم', NULL, 2500, true, 3, false),
        (gen_random_uuid(), v_rest, v_cat, 'تفاح أحمر ١ كغم', NULL, 4000, true, 4, false),
        (gen_random_uuid(), v_rest, v_cat, 'موز ١ كغم', NULL, 3500, false, 5, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'مشروبات', NULL, 3, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'ماء ١.٥ لتر — ٦ قناني', NULL, 3000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'بيبسي ٣٣٠ مل — ٦ علب', NULL, 4500, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'عصير برتقال ١ لتر', NULL, 3000, true, 2, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'منظفات ومستلزمات', NULL, 4, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'مسحوق غسيل ٣ كغم', NULL, 8000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'صابون أطباق ٧٥٠ مل', NULL, 2500, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'مناديل ورقية — ٥ علب', NULL, 4000, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'أكياس قمامة — ٥٠ كيس', NULL, 2000, true, 3, false);
END $$;

-- بقالة الحي (MARKET, IQ-BG-BAGHDAD)
DO $$
DECLARE
  v_city uuid;
  v_gov uuid;
  v_provider uuid := gen_random_uuid();
  v_rest uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_user uuid;
  v_cat uuid;
BEGIN
  SELECT id, governorate_id INTO v_city, v_gov FROM cities WHERE code = 'IQ-BG-BAGHDAD';
  IF v_city IS NULL OR EXISTS (SELECT 1 FROM restaurants WHERE partner_code = 'DEMO-2002') THEN
    RETURN;
  END IF;

  INSERT INTO providers (id, provider_type, status) VALUES (v_provider, 'RESTAURANT', 'ACTIVE');

  INSERT INTO restaurants (id, provider_id, display_name, legal_name, partner_code, description_ar,
      cuisine_tags, merchant_type, onboarding_status, operational_status, minimum_order_iqd,
      rating_average, rating_count, approved_at)
    VALUES (v_rest, v_provider, 'بقالة الحي', 'بقالة الحي', 'DEMO-2002', 'أساسيات البيت، على بعد دقائق. مفتوح على مدار الساعة.',
      '["grocery","mk_bakery"]'::jsonb, 'MARKET', 'APPROVED', 'ACTIVE', 3000,
      4.3, 94, now());

  INSERT INTO restaurant_branches (id, restaurant_id, name, governorate_id, city_id, address_text,
      district_text, phone, is_active, accepts_orders, busy_mode, base_preparation_minutes, delivery_fee_iqd)
    VALUES (v_branch, v_rest, 'الفرع الرئيسي', v_gov, v_city, 'شارع ٦٢، حي الجامعة', 'الجامعة',
      '+9647701110008', true, true, 'NORMAL', 5, 1000);

  INSERT INTO branch_working_hours (id, branch_id, day_of_week, opens_at_minute, closes_at_minute, is_closed)
    VALUES
      (gen_random_uuid(), v_branch, 0, 0, 1440, false),
      (gen_random_uuid(), v_branch, 1, 0, 1440, false),
      (gen_random_uuid(), v_branch, 2, 0, 1440, false),
      (gen_random_uuid(), v_branch, 3, 0, 1440, false),
      (gen_random_uuid(), v_branch, 4, 0, 1440, false),
      (gen_random_uuid(), v_branch, 5, 0, 1440, false),
      (gen_random_uuid(), v_branch, 6, 0, 1440, false);

  INSERT INTO restaurant_commission_configs (id, restaurant_id, commission_flat_iqd, settlement_policy,
      payment_term_days, effective_from, note)
    VALUES (gen_random_uuid(), v_rest, 500, 'HALF_MONTH', 7, now() - interval '1 day', 'Sample shop default');

  SELECT id INTO v_user FROM users WHERE lower(username) = lower('demo.baqala');
  IF v_user IS NULL THEN
    v_user := gen_random_uuid();
    INSERT INTO users (id, username, full_name, password_hash, must_change_password, status)
      VALUES (v_user, 'demo.baqala', 'أبو زيد', '$argon2id$v=19$m=19456,t=2,p=1$2BlSKPs4ETAMlFd/HZjxqw$ugISGCbCGXL66ar08xvT7rK72dTJ8rV9FCU0L5haGkE', false, 'ACTIVE');
  ELSE
    UPDATE users SET password_hash = '$argon2id$v=19$m=19456,t=2,p=1$2BlSKPs4ETAMlFd/HZjxqw$ugISGCbCGXL66ar08xvT7rK72dTJ8rV9FCU0L5haGkE', status = 'ACTIVE', updated_at = now() WHERE id = v_user;
  END IF;

  INSERT INTO restaurant_members (id, restaurant_id, user_id, role, is_active)
    VALUES (gen_random_uuid(), v_rest, v_user, 'OWNER', true);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'الأساسيات', NULL, 0, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'خبز صمون — ١٠ أقراص', NULL, 1000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'حليب ١ لتر', NULL, 2000, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'بيض ١٢ حبة', NULL, 3000, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'سكر ١ كغم', NULL, 1250, true, 3, false),
        (gen_random_uuid(), v_rest, v_cat, 'شاي ٢٠٠ غم', NULL, 3000, true, 4, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'وجبات سريعة', NULL, 1, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'معكرونة ٥٠٠ غم', NULL, 1500, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'تونة معلبة ١٨٥ غم', NULL, 2500, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'فاصولياء معلبة', NULL, 2000, true, 2, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'مشروبات وحلويات', NULL, 2, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'ماء ٠.٥ لتر — ١٢ قنينة', NULL, 3500, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'مشروب غازي ١ لتر', NULL, 1750, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'بسكويت — ٦ قطع', NULL, 2000, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'شوكولاتة', NULL, 1000, true, 3, false);
END $$;

-- ماركت الفرات (MARKET, IQ-AN-HADITHA)
DO $$
DECLARE
  v_city uuid;
  v_gov uuid;
  v_provider uuid := gen_random_uuid();
  v_rest uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_user uuid;
  v_cat uuid;
BEGIN
  SELECT id, governorate_id INTO v_city, v_gov FROM cities WHERE code = 'IQ-AN-HADITHA';
  IF v_city IS NULL OR EXISTS (SELECT 1 FROM restaurants WHERE partner_code = 'DEMO-2007') THEN
    RETURN;
  END IF;

  INSERT INTO providers (id, provider_type, status) VALUES (v_provider, 'RESTAURANT', 'ACTIVE');

  INSERT INTO restaurants (id, provider_id, display_name, legal_name, partner_code, description_ar,
      cuisine_tags, merchant_type, onboarding_status, operational_status, minimum_order_iqd,
      rating_average, rating_count, approved_at)
    VALUES (v_rest, v_provider, 'ماركت الفرات', 'ماركت الفرات', 'DEMO-2007', 'مواد غذائية وخضار ومنظفات، توصيل داخل حديثة.',
      '["grocery","mk_produce","mk_dairy","mk_household"]'::jsonb, 'MARKET', 'APPROVED', 'ACTIVE', 5000,
      4.5, 64, now());

  INSERT INTO restaurant_branches (id, restaurant_id, name, governorate_id, city_id, address_text,
      district_text, phone, is_active, accepts_orders, busy_mode, base_preparation_minutes, delivery_fee_iqd)
    VALUES (v_branch, v_rest, 'الفرع الرئيسي', v_gov, v_city, 'الشارع العام، مركز حديثة', 'مركز حديثة',
      '+9647701110016', true, true, 'NORMAL', 10, 1000);

  INSERT INTO branch_working_hours (id, branch_id, day_of_week, opens_at_minute, closes_at_minute, is_closed)
    VALUES
      (gen_random_uuid(), v_branch, 0, 480, 1440, false),
      (gen_random_uuid(), v_branch, 1, 480, 1440, false),
      (gen_random_uuid(), v_branch, 2, 480, 1440, false),
      (gen_random_uuid(), v_branch, 3, 480, 1440, false),
      (gen_random_uuid(), v_branch, 4, 480, 1440, false),
      (gen_random_uuid(), v_branch, 5, 480, 1440, false),
      (gen_random_uuid(), v_branch, 6, 480, 1440, false);

  INSERT INTO restaurant_commission_configs (id, restaurant_id, commission_flat_iqd, settlement_policy,
      payment_term_days, effective_from, note)
    VALUES (gen_random_uuid(), v_rest, 500, 'HALF_MONTH', 7, now() - interval '1 day', 'Sample shop default');

  SELECT id INTO v_user FROM users WHERE lower(username) = lower('demo.haditha.market');
  IF v_user IS NULL THEN
    v_user := gen_random_uuid();
    INSERT INTO users (id, username, full_name, password_hash, must_change_password, status)
      VALUES (v_user, 'demo.haditha.market', 'عمر الفراتي', '$argon2id$v=19$m=19456,t=2,p=1$Ks8s5r+LByzgcXMk7/GbRA$0LHLle0BeRCqtgFYn1rIEW7hcBKxG9BS27TeGa/VkxQ', false, 'ACTIVE');
  ELSE
    UPDATE users SET password_hash = '$argon2id$v=19$m=19456,t=2,p=1$Ks8s5r+LByzgcXMk7/GbRA$0LHLle0BeRCqtgFYn1rIEW7hcBKxG9BS27TeGa/VkxQ', status = 'ACTIVE', updated_at = now() WHERE id = v_user;
  END IF;

  INSERT INTO restaurant_members (id, restaurant_id, user_id, role, is_active)
    VALUES (gen_random_uuid(), v_rest, v_user, 'OWNER', true);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'ألبان وأجبان', NULL, 0, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'حليب طازج ١ لتر', NULL, 2000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'لبن رائب ٥٠٠ غم', NULL, 1500, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'جبن أبيض ٤٠٠ غم', NULL, 4500, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'بيض ٣٠ حبة', NULL, 7000, true, 3, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'خضار وفواكه', NULL, 1, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'طماطم ١ كغم', NULL, 1500, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'بطاطا ٢ كغم', NULL, 2500, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'خيار ١ كغم', NULL, 1250, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'برتقال ١ كغم', NULL, 3000, true, 3, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'مواد غذائية', NULL, 2, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'رز ٥ كغم', NULL, 11000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'سكر ٢ كغم', NULL, 2500, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'زيت ١.٨ لتر', NULL, 6500, true, 2, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'منظفات', NULL, 3, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'مسحوق غسيل ٣ كغم', NULL, 8000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'صابون أطباق ٧٥٠ مل', NULL, 2500, true, 1, false);
END $$;

-- كوزمتك الورد (COSMETICS, IQ-BG-BAGHDAD)
DO $$
DECLARE
  v_city uuid;
  v_gov uuid;
  v_provider uuid := gen_random_uuid();
  v_rest uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_user uuid;
  v_cat uuid;
BEGIN
  SELECT id, governorate_id INTO v_city, v_gov FROM cities WHERE code = 'IQ-BG-BAGHDAD';
  IF v_city IS NULL OR EXISTS (SELECT 1 FROM restaurants WHERE partner_code = 'DEMO-3001') THEN
    RETURN;
  END IF;

  INSERT INTO providers (id, provider_type, status) VALUES (v_provider, 'RESTAURANT', 'ACTIVE');

  INSERT INTO restaurants (id, provider_id, display_name, legal_name, partner_code, description_ar,
      cuisine_tags, merchant_type, onboarding_status, operational_status, minimum_order_iqd,
      rating_average, rating_count, approved_at)
    VALUES (v_rest, v_provider, 'كوزمتك الورد', 'كوزمتك الورد', 'DEMO-3001', 'مكياج وعناية بالبشرة والشعر من ماركات أصلية، توصيل لباب البيت.',
      '["cs_makeup","cs_skincare","cs_haircare"]'::jsonb, 'COSMETICS', 'APPROVED', 'ACTIVE', 10000,
      4.7, 94, now());

  INSERT INTO restaurant_branches (id, restaurant_id, name, governorate_id, city_id, address_text,
      district_text, phone, is_active, accepts_orders, busy_mode, base_preparation_minutes, delivery_fee_iqd)
    VALUES (v_branch, v_rest, 'الفرع الرئيسي', v_gov, v_city, 'شارع ١٤ رمضان، المنصور', 'المنصور',
      '+9647701110013', true, true, 'NORMAL', 10, 2000);

  INSERT INTO branch_working_hours (id, branch_id, day_of_week, opens_at_minute, closes_at_minute, is_closed)
    VALUES
      (gen_random_uuid(), v_branch, 0, 600, 1380, false),
      (gen_random_uuid(), v_branch, 1, 600, 1380, false),
      (gen_random_uuid(), v_branch, 2, 600, 1380, false),
      (gen_random_uuid(), v_branch, 3, 600, 1380, false),
      (gen_random_uuid(), v_branch, 4, 600, 1380, false),
      (gen_random_uuid(), v_branch, 5, 600, 1380, false),
      (gen_random_uuid(), v_branch, 6, 600, 1380, false);

  INSERT INTO restaurant_commission_configs (id, restaurant_id, commission_flat_iqd, settlement_policy,
      payment_term_days, effective_from, note)
    VALUES (gen_random_uuid(), v_rest, 500, 'HALF_MONTH', 7, now() - interval '1 day', 'Sample shop default');

  SELECT id INTO v_user FROM users WHERE lower(username) = lower('demo.cosmetics');
  IF v_user IS NULL THEN
    v_user := gen_random_uuid();
    INSERT INTO users (id, username, full_name, password_hash, must_change_password, status)
      VALUES (v_user, 'demo.cosmetics', 'رنا الوردي', '$argon2id$v=19$m=19456,t=2,p=1$ChLPcUp3uLLjJHbhg5Nbgw$iNOk4dYPHIJTW2yXoZdHfj+16CH9lRK2Rldo8dIMjxo', false, 'ACTIVE');
  ELSE
    UPDATE users SET password_hash = '$argon2id$v=19$m=19456,t=2,p=1$ChLPcUp3uLLjJHbhg5Nbgw$iNOk4dYPHIJTW2yXoZdHfj+16CH9lRK2Rldo8dIMjxo', status = 'ACTIVE', updated_at = now() WHERE id = v_user;
  END IF;

  INSERT INTO restaurant_members (id, restaurant_id, user_id, role, is_active)
    VALUES (gen_random_uuid(), v_rest, v_user, 'OWNER', true);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'مكياج', NULL, 0, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'أحمر شفاه مات', 'ثابت لساعات طويلة', 12000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'كريم أساس ٣٠ مل', 'تغطية متوسطة', 25000, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'ماسكارا مقاومة للماء', NULL, 15000, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'باليت ظلال عيون ١٢ لون', NULL, 30000, true, 3, false),
        (gen_random_uuid(), v_rest, v_cat, 'كحل أسود', NULL, 6000, true, 4, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'العناية بالبشرة', 'لكل أنواع البشرة', 1, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'غسول وجه ٢٠٠ مل', NULL, 14000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'مرطب يومي ٥٠ مل', 'بعامل حماية SPF 30', 22000, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'سيروم فيتامين C ٣٠ مل', NULL, 28000, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'واقي شمس ٥٠ مل', NULL, 18000, false, 3, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'العناية بالشعر', NULL, 2, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'شامبو ٤٠٠ مل', NULL, 9000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'بلسم ٤٠٠ مل', NULL, 9000, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'زيت أرغان للشعر ١٠٠ مل', NULL, 16000, true, 2, false);
END $$;

-- عطور ليالي (COSMETICS, IQ-BG-BAGHDAD)
DO $$
DECLARE
  v_city uuid;
  v_gov uuid;
  v_provider uuid := gen_random_uuid();
  v_rest uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_user uuid;
  v_cat uuid;
BEGIN
  SELECT id, governorate_id INTO v_city, v_gov FROM cities WHERE code = 'IQ-BG-BAGHDAD';
  IF v_city IS NULL OR EXISTS (SELECT 1 FROM restaurants WHERE partner_code = 'DEMO-3002') THEN
    RETURN;
  END IF;

  INSERT INTO providers (id, provider_type, status) VALUES (v_provider, 'RESTAURANT', 'ACTIVE');

  INSERT INTO restaurants (id, provider_id, display_name, legal_name, partner_code, description_ar,
      cuisine_tags, merchant_type, onboarding_status, operational_status, minimum_order_iqd,
      rating_average, rating_count, approved_at)
    VALUES (v_rest, v_provider, 'عطور ليالي', 'عطور ليالي', 'DEMO-3002', 'عطور شرقية وفرنسية ومستلزمات العناية الشخصية.',
      '["cs_perfume","cs_personal","cs_nails"]'::jsonb, 'COSMETICS', 'APPROVED', 'ACTIVE', 15000,
      4.4, 51, now());

  INSERT INTO restaurant_branches (id, restaurant_id, name, governorate_id, city_id, address_text,
      district_text, phone, is_active, accepts_orders, busy_mode, base_preparation_minutes, delivery_fee_iqd)
    VALUES (v_branch, v_rest, 'الفرع الرئيسي', v_gov, v_city, 'شارع الكرادة داخل', 'الكرادة',
      '+9647701110014', true, true, 'NORMAL', 15, 0);

  INSERT INTO branch_working_hours (id, branch_id, day_of_week, opens_at_minute, closes_at_minute, is_closed)
    VALUES
      (gen_random_uuid(), v_branch, 0, 0, 1440, false),
      (gen_random_uuid(), v_branch, 1, 0, 1440, false),
      (gen_random_uuid(), v_branch, 2, 0, 1440, false),
      (gen_random_uuid(), v_branch, 3, 0, 1440, false),
      (gen_random_uuid(), v_branch, 4, 0, 1440, false),
      (gen_random_uuid(), v_branch, 5, 0, 1440, false),
      (gen_random_uuid(), v_branch, 6, 0, 1440, false);

  INSERT INTO restaurant_commission_configs (id, restaurant_id, commission_flat_iqd, settlement_policy,
      payment_term_days, effective_from, note)
    VALUES (gen_random_uuid(), v_rest, 500, 'HALF_MONTH', 7, now() - interval '1 day', 'Sample shop default');

  SELECT id INTO v_user FROM users WHERE lower(username) = lower('demo.perfume');
  IF v_user IS NULL THEN
    v_user := gen_random_uuid();
    INSERT INTO users (id, username, full_name, password_hash, must_change_password, status)
      VALUES (v_user, 'demo.perfume', 'حيدر العطار', '$argon2id$v=19$m=19456,t=2,p=1$OwPbzxO9BsDsV0owOucCNA$FgF0nA5iGIhJFndCpL5yGcew46jC3J8fLrWwUBfHaX4', false, 'ACTIVE');
  ELSE
    UPDATE users SET password_hash = '$argon2id$v=19$m=19456,t=2,p=1$OwPbzxO9BsDsV0owOucCNA$FgF0nA5iGIhJFndCpL5yGcew46jC3J8fLrWwUBfHaX4', status = 'ACTIVE', updated_at = now() WHERE id = v_user;
  END IF;

  INSERT INTO restaurant_members (id, restaurant_id, user_id, role, is_active)
    VALUES (gen_random_uuid(), v_rest, v_user, 'OWNER', true);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'عطور', NULL, 0, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'عطر عود ١٠٠ مل', 'شرقي فاخر', 45000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'عطر زهري ٥٠ مل', NULL, 35000, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'معطر جسم ٢٥٠ مل', NULL, 10000, true, 2, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'أظافر', NULL, 1, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'طلاء أظافر', NULL, 5000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'مزيل طلاء ١٠٠ مل', NULL, 3000, true, 1, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'عناية شخصية', NULL, 2, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'مزيل عرق ١٥٠ مل', NULL, 7000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'معجون أسنان ١٠٠ مل', NULL, 4000, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'صابون سائل ٥٠٠ مل', NULL, 5000, true, 2, false);
END $$;

-- بيوتي حديثة (COSMETICS, IQ-AN-HADITHA)
DO $$
DECLARE
  v_city uuid;
  v_gov uuid;
  v_provider uuid := gen_random_uuid();
  v_rest uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_user uuid;
  v_cat uuid;
BEGIN
  SELECT id, governorate_id INTO v_city, v_gov FROM cities WHERE code = 'IQ-AN-HADITHA';
  IF v_city IS NULL OR EXISTS (SELECT 1 FROM restaurants WHERE partner_code = 'DEMO-3003') THEN
    RETURN;
  END IF;

  INSERT INTO providers (id, provider_type, status) VALUES (v_provider, 'RESTAURANT', 'ACTIVE');

  INSERT INTO restaurants (id, provider_id, display_name, legal_name, partner_code, description_ar,
      cuisine_tags, merchant_type, onboarding_status, operational_status, minimum_order_iqd,
      rating_average, rating_count, approved_at)
    VALUES (v_rest, v_provider, 'بيوتي حديثة', 'بيوتي حديثة', 'DEMO-3003', 'مكياج وعناية وعطور بأسعار مناسبة، توصيل داخل حديثة.',
      '["cs_makeup","cs_skincare","cs_perfume"]'::jsonb, 'COSMETICS', 'APPROVED', 'ACTIVE', 7000,
      4.6, 38, now());

  INSERT INTO restaurant_branches (id, restaurant_id, name, governorate_id, city_id, address_text,
      district_text, phone, is_active, accepts_orders, busy_mode, base_preparation_minutes, delivery_fee_iqd)
    VALUES (v_branch, v_rest, 'الفرع الرئيسي', v_gov, v_city, 'الشارع العام، مركز حديثة', 'مركز حديثة',
      '+9647701110015', true, true, 'NORMAL', 10, 1500);

  INSERT INTO branch_working_hours (id, branch_id, day_of_week, opens_at_minute, closes_at_minute, is_closed)
    VALUES
      (gen_random_uuid(), v_branch, 0, 540, 1380, false),
      (gen_random_uuid(), v_branch, 1, 540, 1380, false),
      (gen_random_uuid(), v_branch, 2, 540, 1380, false),
      (gen_random_uuid(), v_branch, 3, 540, 1380, false),
      (gen_random_uuid(), v_branch, 4, 540, 1380, false),
      (gen_random_uuid(), v_branch, 5, 540, 1380, false),
      (gen_random_uuid(), v_branch, 6, 540, 1380, false);

  INSERT INTO restaurant_commission_configs (id, restaurant_id, commission_flat_iqd, settlement_policy,
      payment_term_days, effective_from, note)
    VALUES (gen_random_uuid(), v_rest, 500, 'HALF_MONTH', 7, now() - interval '1 day', 'Sample shop default');

  SELECT id INTO v_user FROM users WHERE lower(username) = lower('demo.haditha.beauty');
  IF v_user IS NULL THEN
    v_user := gen_random_uuid();
    INSERT INTO users (id, username, full_name, password_hash, must_change_password, status)
      VALUES (v_user, 'demo.haditha.beauty', 'سارة الحديثي', '$argon2id$v=19$m=19456,t=2,p=1$MMooGhr2kp6YX16qLSi8uw$KKhMbbvtmX01OFG5atZgUBRi/i+Qxl0jeklrLRGjo2M', false, 'ACTIVE');
  ELSE
    UPDATE users SET password_hash = '$argon2id$v=19$m=19456,t=2,p=1$MMooGhr2kp6YX16qLSi8uw$KKhMbbvtmX01OFG5atZgUBRi/i+Qxl0jeklrLRGjo2M', status = 'ACTIVE', updated_at = now() WHERE id = v_user;
  END IF;

  INSERT INTO restaurant_members (id, restaurant_id, user_id, role, is_active)
    VALUES (gen_random_uuid(), v_rest, v_user, 'OWNER', true);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'مكياج', NULL, 0, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'أحمر شفاه سائل', NULL, 9000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'بودرة مضغوطة', NULL, 14000, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'ماسكارا', NULL, 11000, true, 2, false),
        (gen_random_uuid(), v_rest, v_cat, 'قلم تحديد عيون', NULL, 5000, true, 3, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'العناية بالبشرة', NULL, 1, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'كريم مرطب ١٠٠ مل', NULL, 12000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'غسول وجه للبشرة الدهنية', NULL, 10000, true, 1, false),
        (gen_random_uuid(), v_rest, v_cat, 'ماسك طين ١٢٠ غم', NULL, 8000, true, 2, false);

  v_cat := gen_random_uuid();
  INSERT INTO menu_categories (id, restaurant_id, name_ar, description_ar, sort_order, is_active)
    VALUES (v_cat, v_rest, 'عطور', NULL, 2, true);
  INSERT INTO menu_items (id, restaurant_id, category_id, name_ar, description_ar, base_price_iqd, is_available, sort_order, is_popular)
    VALUES
        (gen_random_uuid(), v_rest, v_cat, 'عطر مسك ٥٠ مل', NULL, 20000, true, 0, false),
        (gen_random_uuid(), v_rest, v_cat, 'بخاخ جسم ٢٠٠ مل', NULL, 8000, true, 1, false);
END $$;
