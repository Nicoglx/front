import React, { useState, useEffect } from 'react';
import useTranslation from 'next-translate/useTranslation';
import Link from 'next/link';
import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import InputGroup from 'react-bootstrap/InputGroup';
import FormControl from 'react-bootstrap/FormControl';
import Button from 'react-bootstrap/Button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPhone } from '@fortawesome/free-solid-svg-icons';

import parseISO from 'date-fns/parseISO';
import Router, { useRouter } from 'next/router';
import { GetServerSideProps } from 'next';
import { getToken } from 'src/utils/next';
import * as Sentry from '@sentry/browser';
import {
  GoogleReCaptchaProvider,
  useGoogleReCaptcha,
} from 'react-google-recaptcha-v3';

import Layout from 'src/components/Layout';
import { getErrorCodeFromApollo } from 'src/utils';
import graphqlClient from 'src/graphqlClient';
import Spinner from 'src/components/Spinner';
import GoBack from 'src/components/GoBack';
import { formattedTimeDifference } from 'src/utils/dates';
import RegistrationDisabled from 'src/components/RegistrationDisabled';

const VERIFY_CODE = /* GraphQL */ `
  mutation VerifyCode($code: Int!, $phone: String!) {
    verifyCode(code: $code, phone: $phone)
  }
`;

const VERIFY_PHONE = /* GraphQL */ `
  mutation VerifyPhone($phone: String!, $token: String!) {
    verifyPhone(phone: $phone, token: $token)
  }
`;

const VerifyPhone = () => {
  const { t } = useTranslation();
  const router = useRouter();

  const { executeRecaptcha } = useGoogleReCaptcha();
  const [sendCodeScreen, setSendCodeScreen] = useState(true);
  const [phone, setPhone] = useState<string>('');
  const [code, setCode] = useState<number>();
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errors, setErrors] = useState<{ phone?: string; code?: string }>({});
  const [expiresIn, setExpiresIn] = useState<Date>();
  const [countDown, setCountDown] = useState('');

  const onChange = (e) => {
    setErrors({});
    e.target.name === 'phone'
      ? setPhone(e.target.value)
      : setCode(e.target.value);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (sendCodeScreen) {
      onSendCode();
    } else {
      onVerifyCode();
    }
  };

  const onSendCode = async () => {
    setIsSubmitting(true);

    if (!executeRecaptcha) {
      setIsSubmitting(false);
      return;
    }

    const token = await executeRecaptcha('register');

    try {
      const res = await graphqlClient.request(VERIFY_PHONE, { phone, token });
      setExpiresIn(parseISO(res.verifyPhone));
      setIsSubmitting(false);
      setSendCodeScreen(false);
    } catch (error) {
      const code = getErrorCodeFromApollo(error);

      switch (code) {
        case 'LIMIT_CODE_SENT_EXCEEDED':
          setErrors({ ...errors, phone: t('common:limit-code-sent-exceeded') });
          break;
        case 'IN_PROGRESS_VERIFICATION':
          setErrors({ ...errors, phone: t('common:in-progress-verification') });
          break;
        case 'INVALID_PHONE':
        case 'INVALID_NATIONAL_PHONE':
          setErrors({ ...errors, phone: t('common:phone-invalid') });
          break;
        default:
          setErrors({ ...errors, phone: t('common:mutation-error') });
          break;
      }

      Sentry.captureException(error);
      setIsSubmitting(false);
    }
  };

  const onVerifyCode = async () => {
    if (!code) {
      setErrors({ ...errors, code: t('common:code-required') });
      return;
    }

    setIsSubmitting(true);

    try {
      await graphqlClient.request(VERIFY_CODE, { code: Number(code), phone });

      const redirectTo = (router.query.redirectTo as string) || '/';

      Router.push(redirectTo);
    } catch (error) {
      const code = getErrorCodeFromApollo(error);

      if (['PHONE_NOT_REGISTERED', 'CODE_EXPIRED'].includes(code)) {
        setErrors({ ...errors, phone: t('common:verification-failed') });
        setIsSubmitting(false);
        setSendCodeScreen(true);
        return;
      }

      if ('INCORRECT_CODE' === code) {
        setErrors({ ...errors, code: t('common:incorrect-code') });
        setIsSubmitting(false);
      }

      setIsSubmitting(false);
      Sentry.captureException(error);
    }
  };

  useEffect(() => {
    if (!expiresIn) {
      return;
    }

    const interval = setInterval(() => {
      const formattedDif = formattedTimeDifference(expiresIn);
      if (formattedDif !== null) {
        setCountDown(formattedDif);
      } else {
        setCountDown('');
        setErrors({ ...errors, phone: t('common:expired-code') });
        setSendCodeScreen(true);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresIn]);

  return (
    <Layout>
      <Card className="cauda_card mb-4 mx-auto text-center">
        <Card.Header className="text-left">
          {sendCodeScreen && <GoBack />}
          {t('common:register')}
        </Card.Header>
        <Card.Body>
          <Form onSubmit={handleSubmit}>
            {sendCodeScreen && (
              <>
                {router.query.redirectTo === '/my-shop' ? (
                  <p>{t('common:register-shop')}</p>
                ) : (
                  <p>{t('common:register-client')}</p>
                )}

                <Form.Group controlId="register-cellphone">
                  <Form.Label className="sr-only">
                    {t('common:register-cellphone')}
                  </Form.Label>
                  <InputGroup size="lg">
                    <InputGroup.Prepend>
                      <InputGroup.Text>
                        <FontAwesomeIcon icon={faPhone} fixedWidth />
                      </InputGroup.Text>
                    </InputGroup.Prepend>
                    <FormControl
                      autoFocus
                      placeholder={t('common:enter-cellphone')}
                      type="tel"
                      name="phone"
                      value={phone}
                      onChange={onChange}
                      isInvalid={!!errors.phone}
                      disabled={isSubmitting}
                    />
                    <FormControl.Feedback type="invalid">
                      {errors.phone}
                    </FormControl.Feedback>
                  </InputGroup>
                </Form.Group>

                <Button
                  onClick={onSendCode}
                  variant="primary"
                  size="lg"
                  className="mb-3 mb-sm-1"
                  block
                >
                  {isSubmitting ? <Spinner /> : t('common:send-code')}
                </Button>
              </>
            )}

            {!sendCodeScreen && (
              <>
                <Form.Group controlId="shop-cellphone">
                  <Form.Label className="sr-only">
                    {t('common:enter-code')}
                  </Form.Label>
                  <InputGroup size="lg">
                    <FormControl
                      autoFocus
                      placeholder={t('common:enter-code')}
                      type="tel"
                      name="code"
                      value={code}
                      onChange={onChange}
                      isInvalid={!!errors.code}
                      disabled={isSubmitting}
                    />
                    <FormControl.Feedback type="invalid">
                      {errors.code}
                    </FormControl.Feedback>
                  </InputGroup>
                </Form.Group>

                <Button
                  onClick={onVerifyCode}
                  variant="primary"
                  size="lg"
                  className="mb-3 mb-sm-1"
                  block
                  disabled={isSubmitting}
                >
                  {`${t('common:verify-code')} ${countDown}`}
                </Button>
              </>
            )}

            <small className="text-muted">
              {t('common:accept-by-continue')}{' '}
              <Link href="/terms">
                <a>{t('common:terms-conditions')}</a>
              </Link>
              .
            </small>
          </Form>
        </Card.Body>
      </Card>
    </Layout>
  );
};

const VerifyPhoneWithCaptcha = ({
  isLoggedIn,
  clientEnabled,
  shopEnabled,
}: {
  isLoggedIn: boolean;
  clientEnabled: boolean;
  shopEnabled: boolean;
}) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn) {
      router.push('/');
      setLoading(true);
    }
  }, []);

  if (
    (!shopEnabled && router.query.redirectTo === '/my-shop') ||
    (!clientEnabled && router.query.redirectTo !== '/my-shop')
  ) {
    return <RegistrationDisabled />;
  }

  if (loading) {
    return (
      <Layout>
        <Spinner />
      </Layout>
    );
  }

  return (
    <GoogleReCaptchaProvider
      reCaptchaKey={process.env.NEXT_PUBLIC_RE_CAPTCHA_KEY}
    >
      <VerifyPhone />
    </GoogleReCaptchaProvider>
  );
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const token = getToken(context);

  return {
    props: {
      isLoggedIn: token !== null,
      clientEnabled: process.env.CAUDA_CLIENT_REGISTRATION_ENABLED === '1',
      shopEnabled: process.env.CAUDA_SHOP_REGISTRATION_ENABLED === '1',
    },
  };
};

export default VerifyPhoneWithCaptcha;
